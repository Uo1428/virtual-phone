import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, INotification, TelnyxRTC } from "@telnyx/webrtc";
import { api } from "../api/client";
import { useStateStream } from "../api/useEventStream";
import { unlockRingtone } from "../lib/ringtone";
import { deviceLabel, getTabId, watchTabIdentity } from "../lib/tabIdentity";

/** Give up on an outbound call that never connects, so it can't bill forever. */
const NO_ANSWER_TIMEOUT_MS = 45_000;

export type TelnyxStatus = "idle" | "connecting" | "ready" | "error";

/** A live call-quality warning reported by the Telnyx SDK. */
export interface CallQualityWarning {
  code: string;
  name: string;
  message: string;
  description: string;
  solutions: string[];
}

type CallStateDto = "initiated" | "ringing" | "active" | "ended" | "failed";

function mapCallState(state: string): CallStateDto {
  switch (state) {
    case "new":
    case "requesting":
    case "trying":
      return "initiated";
    case "ringing":
    case "early":
      return "ringing";
    case "active":
    case "held":
      return "active";
    case "hangup":
    case "destroy":
    case "purge":
      return "ended";
    default:
      return "initiated";
  }
}

// Lazy-load the (large) WebRTC SDK only when a tab actually connects.
type WebrtcModule = typeof import("@telnyx/webrtc");
let webrtcPromise: Promise<WebrtcModule> | null = null;
function loadWebrtc(): Promise<WebrtcModule> {
  webrtcPromise ??= import("@telnyx/webrtc");
  return webrtcPromise;
}

type VendorWindow = Window &
  typeof globalThis & {
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
    mozRTCPeerConnection?: typeof RTCPeerConnection;
  };

/**
 * The Telnyx SDK builds its peer with `new window.RTCPeerConnection(...)` and
 * has no vendor fallback, so a missing global crashes the call with
 * "window.RTCPeerConnection is not a constructor". WebRTC is absent in
 * insecure contexts (plain http:// on anything but localhost), in browsers
 * with WebRTC disabled, and behind some webviews/iframes. Detect that up front
 * so the UI can explain it, and bridge legacy prefixed constructors for the
 * SDK while we're at it.
 */
function webRtcSupportError(): string | null {
  const w = window as VendorWindow;
  if (!w.RTCPeerConnection) {
    const vendor = w.webkitRTCPeerConnection ?? w.mozRTCPeerConnection;
    if (vendor) w.RTCPeerConnection = vendor;
  }
  if (typeof w.RTCPeerConnection !== "function") {
    return window.isSecureContext
      ? "This browser doesn't support WebRTC (the softphone's audio transport). Try a recent Chrome, Edge, Firefox, or Safari."
      : "WebRTC is blocked because this page isn't in a secure context. Open the app over https:// or on http://localhost.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "This browser doesn't expose microphone capture (getUserMedia), which the softphone needs.";
  }
  return null;
}

export interface UseTelnyxResult {
  status: TelnyxStatus;
  error: string | null;
  calls: Call[];
  /** Latest call-quality warning per SDK call id. */
  warnings: Record<string, CallQualityWarning>;
  sipUsername: string | null;
  numberId: string | null;
  tabId: string;
  connect: (numberId: string) => Promise<void>;
  disconnect: () => void;
  startCall: (destinationNumber: string, callerNumber: string, dbCallId?: string) => Call | null;
  answerCall: (call: Call) => Promise<void>;
}

/**
 * Wraps TelnyxRTC (one client per tab). The official @telnyx/react-client is
 * stale, so we manage the SDK directly.
 */
export function useTelnyx(): UseTelnyxResult {
  const clientRef = useRef<TelnyxRTC | null>(null);
  const [tabId, setTabId] = useState<string>(() => getTabId());
  const tabIdRef = useRef<string>(tabId);
  const disconnectRef = useRef<() => void>(() => {});

  // A duplicated tab copies sessionStorage; detect it and adopt a fresh id so
  // the server sees two distinct tabs and blocks the second from connecting.
  useEffect(
    () =>
      watchTabIdentity((id) => {
        tabIdRef.current = id;
        setTabId(id);
      }),
    [],
  );

  const numberIdRef = useRef<string | null>(null);
  const dbCallIdBySdkId = useRef<Map<string, string>>(new Map());
  const sinkContainerRef = useRef<HTMLDivElement | null>(null);
  const sinksRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const noAnswerTimers = useRef<Map<string, number>>(new Map());
  const [status, setStatus] = useState<TelnyxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [warnings, setWarnings] = useState<Record<string, CallQualityWarning>>({});
  const [sipUsername, setSipUsername] = useState<string | null>(null);
  const [numberId, setNumberId] = useState<string | null>(null);

  // If another tab force-takes this number, drop our connection immediately.
  useStateStream((event) => {
    if (event.type === "revoked" && event.numberId && event.numberId === numberIdRef.current) {
      disconnectRef.current();
      setError("This number was taken over in another tab.");
    }
  });

  const sinkFor = useCallback((callId: string): HTMLAudioElement => {
    let container = sinkContainerRef.current;
    if (!container) {
      container = document.createElement("div");
      container.style.display = "none";
      document.body.appendChild(container);
      sinkContainerRef.current = container;
    }
    let element = sinksRef.current.get(callId);
    if (!element) {
      element = document.createElement("audio");
      element.autoplay = true;
      element.setAttribute("playsinline", "true");
      container.appendChild(element);
      sinksRef.current.set(callId, element);
    }
    return element;
  }, []);

  const releaseSink = useCallback((callId: string) => {
    const element = sinksRef.current.get(callId);
    if (element) {
      element.srcObject = null;
      element.remove();
      sinksRef.current.delete(callId);
    }
  }, []);

  const clearNoAnswerTimer = useCallback((callId: string) => {
    const timer = noAnswerTimers.current.get(callId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      noAnswerTimers.current.delete(callId);
    }
  }, []);

  const handleNotification = useCallback(
    (notification: INotification) => {
      if (notification.type !== "callUpdate" || !notification.call) return;
      const call = notification.call;
      setCalls((prev) => [...prev.filter((c) => c.id !== call.id), call]);

      if (call.state === "hangup" || call.state === "destroy" || call.state === "purge") {
        releaseSink(call.id);
        setWarnings((prev) => {
          if (!(call.id in prev)) return prev;
          const next = { ...prev };
          delete next[call.id];
          return next;
        });
      }
      // Once the call is up (or over) the no-answer guard is no longer needed.
      if (call.state !== "new" && call.state !== "requesting" && call.state !== "trying" && call.state !== "ringing" && call.state !== "early") {
        clearNoAnswerTimer(call.id);
      }

      const dbCallId = dbCallIdBySdkId.current.get(call.id);
      if (dbCallId) {
        const ids = call.telnyxIDs;
        void api
          .updateCallStatus(dbCallId, {
            state: mapCallState(call.state),
            telnyxSessionId: ids?.telnyxSessionId || null,
            telnyxCallControlId: ids?.telnyxCallControlId || null,
            telnyxLegId: ids?.telnyxLegId || null,
          })
          .catch(() => undefined);
      }
    },
    [releaseSink, clearNoAnswerTimer],
  );

  const attach = useCallback(
    (client: TelnyxRTC, tokenExpiringCode: number) => {
      client.on("telnyx.ready", () => setStatus("ready"));
      client.on("telnyx.notification", handleNotification);
      client.on("telnyx.error", (event) => {
        setError(event?.error?.message ?? "Telnyx error");
        setStatus("error");
      });
      client.on("telnyx.warning", (event) => {
        const warning = event?.warning;
        if (!warning) return;
        if (warning.code === tokenExpiringCode && numberIdRef.current) {
          void api
            .refresh(numberIdRef.current, tabIdRef.current, deviceLabel())
            .then((fresh) => client.login({ creds: { login_token: fresh.loginToken } }))
            .catch(() => undefined);
          return;
        }
        // Call-quality warnings (31001 latency, 31005 low mic, …): surface them
        // on the call instead of only letting the SDK log to the console.
        if (!event.callId) return;
        const callId = event.callId;
        setWarnings((prev) => ({
          ...prev,
          [callId]: {
            code: String(warning.code),
            name: warning.name,
            message: warning.message,
            description: warning.description,
            solutions: [...warning.solutions],
          },
        }));
      });
    },
    [handleNotification],
  );

  const connect = useCallback(
    async (targetNumberId: string) => {
      // Runs synchronously inside the Connect tap: unlock the ringtone's
      // AudioContext so a later inbound call is allowed to play sound.
      unlockRingtone();
      // Fail fast with a readable message when the browser can't do WebRTC at
      // all, instead of letting the SDK crash mid-call.
      const supportError = webRtcSupportError();
      if (supportError) {
        setError(supportError);
        setStatus("error");
        throw new Error(supportError);
      }
      // One number per tab: release whatever this tab currently holds first.
      if (clientRef.current && numberIdRef.current && numberIdRef.current !== targetNumberId) {
        void clientRef.current.disconnect();
        clientRef.current = null;
        void api.release(tabIdRef.current, numberIdRef.current).catch(() => undefined);
      }
      setStatus("connecting");
      setError(null);
      const [mod, token] = await Promise.all([
        loadWebrtc(),
        api.token(targetNumberId, tabIdRef.current, deviceLabel()),
      ]);
      numberIdRef.current = targetNumberId;
      setNumberId(targetNumberId);
      setSipUsername(token.sipUsername);
      const client = new mod.TelnyxRTC({ login_token: token.loginToken });
      attach(client, mod.TELNYX_WARNING_CODES.TOKEN_EXPIRING_SOON);
      clientRef.current = client;
      try {
        await client.connect();
      } catch (e) {
        clientRef.current = null;
        setStatus("error");
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [attach],
  );

  const disconnect = useCallback(() => {
    void clientRef.current?.disconnect();
    clientRef.current = null;
    if (numberIdRef.current) {
      void api.release(tabIdRef.current, numberIdRef.current).catch(() => undefined);
    }
    numberIdRef.current = null;
    for (const id of [...sinksRef.current.keys()]) releaseSink(id);
    for (const id of [...noAnswerTimers.current.keys()]) clearNoAnswerTimer(id);
    setStatus("idle");
    setCalls([]);
    setWarnings({});
    setSipUsername(null);
    setNumberId(null);
  }, [releaseSink, clearNoAnswerTimer]);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  const startCall = useCallback(
    (destinationNumber: string, callerNumber: string, dbCallId?: string) => {
      const client = clientRef.current;
      if (!client) return null;
      const id = crypto.randomUUID();
      const sink = sinkFor(id);
      const call = client.newCall({
        id,
        destinationNumber,
        callerNumber,
        remoteElement: sink,
        // Pin processing so the local level is deterministic (AGC on) instead
        // of relying on browser defaults; keeps "low local audio" honest.
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (dbCallId) dbCallIdBySdkId.current.set(call.id, dbCallId);
      setCalls((prev) => [...prev, call]);

      // Guard: if the far end never answers, tear the leg down instead of
      // leaving it (and the PSTN leg) connected and billing.
      clearNoAnswerTimer(call.id);
      const timer = window.setTimeout(() => {
        noAnswerTimers.current.delete(call.id);
        void call.hangup();
        if (dbCallId) {
          void api
            .updateCallStatus(dbCallId, { state: "failed", hangupCause: "no_answer" })
            .catch(() => undefined);
        }
      }, NO_ANSWER_TIMEOUT_MS);
      noAnswerTimers.current.set(call.id, timer);

      return call;
    },
    [sinkFor, clearNoAnswerTimer],
  );

  const answerCall = useCallback(
    async (call: Call) => {
      const sink = sinkFor(call.id);
      await call.answer({ remoteElement: sink });
    },
    [sinkFor],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      void api
        .heartbeat(tabIdRef.current, numberIdRef.current ?? undefined)
        .then((res) => {
          // Server no longer recognises this tab's registration → we were
          // force-released elsewhere; drop the local connection.
          if (numberIdRef.current && res.registered === false) {
            disconnect();
            setError("This number was taken over in another tab.");
          }
        })
        .catch(() => undefined);
    }, 30_000);
    const onUnload = () => {
      // Best-effort: tell the server every call this tab started has ended, so
      // it hangs up the PSTN legs instead of leaving them billing.
      for (const dbCallId of dbCallIdBySdkId.current.values()) {
        void fetch(`/api/calls/${dbCallId}/status`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state: "ended", hangupCause: "client_closed" }),
          keepalive: true,
        }).catch(() => undefined);
      }
      void api.unregister(tabIdRef.current);
      void clientRef.current?.disconnect();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [disconnect]);

  return {
    status,
    error,
    calls,
    warnings,
    sipUsername,
    numberId,
    tabId,
    connect,
    disconnect,
    startCall,
    answerCall,
  };
}
