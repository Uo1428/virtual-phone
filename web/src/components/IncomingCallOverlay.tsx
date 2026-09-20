import { Button, Call, CallIncoming, PhoneHangup } from "@virtual-phone/ui";
import { useEffect, useRef } from "react";
import { startRingtone, type RingtoneHandle } from "../lib/ringtone";
import { useTelnyxContext } from "../telnyx/TelnyxProvider";

/**
 * App-wide inbound-call prompt. Mounted once per authenticated session so a
 * ringing call is visible (and answerable) from any route, and the ringtone
 * starts/stops in lockstep with the call's `ringing` state.
 */
export function IncomingCallOverlay() {
  const telnyx = useTelnyxContext();
  const incoming =
    telnyx.calls.find((call) => call.state === "ringing" && call.direction === "inbound") ?? null;
  const incomingId = incoming?.id ?? null;
  const ringtoneRef = useRef<RingtoneHandle | null>(null);

  useEffect(() => {
    if (!incomingId) return;
    const handle = startRingtone();
    ringtoneRef.current = handle;
    return () => {
      handle.stop();
      if (ringtoneRef.current === handle) ringtoneRef.current = null;
    };
  }, [incomingId]);

  if (!incoming) return null;

  const stopRingtone = () => {
    ringtoneRef.current?.stop();
    ringtoneRef.current = null;
  };

  const caller =
    incoming.options.remoteCallerNumber ||
    incoming.options.callerNumber ||
    incoming.options.destinationNumber ||
    "Unknown caller";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming call from ${caller}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            <CallIncoming size={26} />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Incoming call
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{caller}</p>
            <p className="text-xs text-muted-foreground">Ringing…</p>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <Button
            variant="secondary"
            className="h-12 flex-1"
            onClick={() => {
              stopRingtone();
              void incoming.hangup();
            }}
          >
            <PhoneHangup size={16} /> Decline
          </Button>
          <Button
            className="h-12 flex-1"
            onClick={() => {
              stopRingtone();
              void telnyx.answerCall(incoming);
            }}
          >
            <Call size={16} /> Answer
          </Button>
        </div>
      </div>
    </div>
  );
}
