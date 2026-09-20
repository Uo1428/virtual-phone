/**
 * Incoming-call ringtone, synthesized with the Web Audio API.
 *
 * Why no audio file: browsers block audio playback until the user interacts
 * with the page. A call can only ever ring after the user has pressed
 * "Connect" (a gesture), so we build one shared AudioContext at that moment
 * via `unlockRingtone()` and reuse it for every ring. That keeps the ringtone
 * reliable without shipping an asset or fighting autoplay policy.
 *
 * Cadence mirrors a classic phone ring: two mixed tones (440 + 480 Hz) for
 * ~1.2s, then ~2s of silence, repeating until `stop()` is called. Pulses are
 * scheduled on the audio clock a couple of minutes ahead, because background
 * tabs throttle timers but not the audio thread — so a call still rings while
 * the tab is in the background.
 */

type AudioContextCtor = typeof AudioContext;

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;

const RING_ON_SEC = 1.2;
const RING_OFF_SEC = 2;
const TONE_HZ = [440, 480] as const;
const MASTER_GAIN = 0.25;
/** How far ahead ring pulses are queued, and how often the queue is topped up. */
const SCHEDULE_AHEAD_SEC = 120;
const TOP_UP_MS = 30_000;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function getAudioContext(): AudioContext | null {
  if (!audioContext) {
    const Ctor = resolveAudioContextCtor();
    if (!Ctor) return null;
    try {
      audioContext = new Ctor();
      masterGain = audioContext.createGain();
      masterGain.gain.value = MASTER_GAIN;
      masterGain.connect(audioContext.destination);
    } catch {
      audioContext = null;
      masterGain = null;
      return null;
    }
  }
  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => undefined);
  }
  return audioContext;
}

/**
 * Prime audio from inside a user gesture (the Connect tap). Afterwards the
 * context is allowed to play without further interaction, so an inbound call
 * that arrives minutes later can still ring.
 */
export function unlockRingtone(): void {
  getAudioContext();
}

export interface RingtoneHandle {
  /** Idempotent — safe to call from a cleanup and an event handler. */
  stop: () => void;
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Vibration unsupported or blocked — the tone still plays.
  }
}

/** Start the looping ring. Call `stop()` on answer, decline, or hangup. */
export function startRingtone(): RingtoneHandle {
  const ctx = getAudioContext();
  const gain = masterGain;
  if (!ctx || !gain) return { stop: () => {} };

  let stopped = false;
  const oscillators = new Set<OscillatorNode>();
  let nextStart = ctx.currentTime;

  const schedulePulse = (start: number) => {
    const end = start + RING_ON_SEC;
    for (const hz of TONE_HZ) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(hz, start);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.5, start + 0.02);
      env.gain.setValueAtTime(0.5, end - 0.05);
      env.gain.linearRampToValueAtTime(0, end);

      osc.connect(env);
      env.connect(gain);
      osc.start(start);
      osc.stop(end + 0.02);
      oscillators.add(osc);
      osc.onended = () => oscillators.delete(osc);
    }
  };

  const fillQueue = () => {
    if (stopped || ctx.state === "closed") return;
    const horizon = ctx.currentTime + SCHEDULE_AHEAD_SEC;
    while (nextStart < horizon) {
      schedulePulse(nextStart);
      nextStart += RING_ON_SEC + RING_OFF_SEC;
    }
  };

  fillQueue();
  // Top up well before the queued window runs dry; harmless if throttled.
  const topUp = setInterval(fillQueue, TOP_UP_MS);
  vibrate([400, 200, 400]);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(topUp);
      for (const osc of oscillators) {
        try {
          osc.stop();
        } catch {
          // Already scheduled to stop.
        }
      }
      oscillators.clear();
      vibrate(0);
    },
  };
}
