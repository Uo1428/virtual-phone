import {
  AnimatedBadge,
  type AnimatedBadgeStatus,
  Button,
  Call,
  CallIncoming,
  CallOutgoing,
  CheckCircle,
  Clock,
  Coin,
  LoadingBlock,
  Microphone,
  MicrophoneSlash,
  PageHeader,
  Panel,
  Pause,
  PhoneHangup,
  Play,
  Refresh,
  StatCard,
  Warning,
  cn,
} from "@virtual-phone/ui";
import type { NumberDto } from "@virtual-phone/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useStateStream } from "../api/useEventStream";
import { usePolling } from "../hooks/usePolling";
import { formatDuration, formatMoney, formatTime } from "../lib/format";
import { useTelnyxContext } from "../telnyx/TelnyxProvider";

const STATUS_BADGE: Record<string, AnimatedBadgeStatus> = {
  ready: "success",
  connecting: "loading",
  error: "danger",
  idle: "neutral",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "Ready",
  connecting: "Connecting",
  error: "Error",
  idle: "Idle",
};

type NumberState = "connected" | "connecting" | "error" | "in_use" | "unassigned" | "available";

const NUMBER_BADGE: Record<NumberState, { status: AnimatedBadgeStatus; label: string }> = {
  connected: { status: "success", label: "Connected" },
  connecting: { status: "loading", label: "Connecting" },
  error: { status: "danger", label: "Failed" },
  in_use: { status: "warning", label: "In use elsewhere" },
  unassigned: { status: "warning", label: "Needs assignment" },
  available: { status: "neutral", label: "Not connected" },
};

// Quick-dial chips list the account's other numbers; the dot hints whether the
// peer is currently registered (callable on-net) and the sort surfaces those.
const QUICK_DOT: Record<NumberState, string> = {
  connected: "bg-emerald-500",
  in_use: "bg-emerald-500",
  connecting: "bg-primary",
  available: "bg-muted-foreground/40",
  unassigned: "bg-amber-500",
  error: "bg-destructive",
};

const QUICK_RANK: Record<NumberState, number> = {
  connected: 0,
  in_use: 0,
  connecting: 1,
  available: 2,
  unassigned: 3,
  error: 4,
};

/** Compare phone numbers by digits so +1 (555) 010-0000 matches +15550100000. */
function samePhone(a: string, b: string): boolean {
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  return da.length > 0 && da === db;
}

export function PhonePage() {
  const telnyx = useTelnyxContext();
  const { data, refresh } = usePolling(() => api.overview(), 4000);
  // Another tab connecting/releasing a number pushes this, so occupancy is live.
  useStateStream(refresh);
  const [selected, setSelected] = useState("");
  const [destination, setDestination] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const numbers = data?.numbers ?? [];
  const occupancy = data?.occupancy ?? {};

  useEffect(() => {
    if (!selected && numbers.length > 0) setSelected(numbers[0]!.id);
  }, [numbers, selected]);

  const selectedNumber = numbers.find((n) => n.id === selected) ?? null;
  const registered = telnyx.status === "ready" && Boolean(telnyx.numberId);
  const connectedNumber = numbers.find((n) => n.id === telnyx.numberId) ?? null;
  const dialerNumber = connectedNumber ?? selectedNumber;

  // A number's state comes from THIS tab's Telnyx status first (immediate), then
  // from occupancy held by other tabs. Occupancy lingers ~90s after a
  // disconnect, so it must never describe the current tab.
  const stateFor = (n: NumberDto): NumberState => {
    if (telnyx.numberId === n.id) {
      if (telnyx.status === "ready") return "connected";
      if (telnyx.status === "connecting") return "connecting";
      if (telnyx.status === "error") return "error";
    }
    const h = occupancy[n.id] ?? null;
    if (h?.online && h.tabId !== telnyx.tabId) return "in_use";
    if (!n.assignedToCallControl) return "unassigned";
    return "available";
  };

  const selectedState = selectedNumber ? stateFor(selectedNumber) : null;
  const selectedIsConnected = Boolean(
    selectedNumber && telnyx.numberId === selectedNumber.id && telnyx.status === "ready",
  );
  const hasUnassigned = numbers.some((n) => !n.assignedToCallControl);
  // Other account numbers we could dial on-net, minus the one this tab holds.
  const quickDial = numbers
    .filter((n) => n.id !== connectedNumber?.id)
    .map((n) => ({ number: n, state: stateFor(n) }))
    .sort((a, b) => QUICK_RANK[a.state] - QUICK_RANK[b.state]);
  // Guard: you can't dial the number this tab is currently connected as.
  const selfCall = Boolean(
    connectedNumber && destination && samePhone(destination, connectedNumber.phoneNumber),
  );
  const active = telnyx.calls.filter(
    (c) => c.state !== "hangup" && c.state !== "destroy" && c.state !== "purge",
  );

  const connect = async () => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      await telnyx.connect(selected);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => {
    telnyx.disconnect();
    refresh();
  };

  const forceTakeover = async () => {
    if (!selectedNumber) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.takeover(selectedNumber.id);
      await telnyx.connect(selectedNumber.id);
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const placeCall = async () => {
    if (!dialerNumber || !destination) return;
    setActionError(null);
    if (selfCall) {
      setActionError("That's the number this tab is connected as — pick a different destination.");
      return;
    }
    try {
      const created = await api.startOutbound(dialerNumber.id, destination);
      telnyx.startCall(destination, dialerNumber.phoneNumber, created.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        icon={<Call size={20} />}
        title="Softphone"
        description="Register a number in this tab, then dial out or answer inbound calls."
        actions={
          <AnimatedBadge status={STATUS_BADGE[telnyx.status] ?? "neutral"}>
            {STATUS_LABEL[telnyx.status] ?? telnyx.status}
          </AnimatedBadge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Numbers"
          description="Pick a number, then connect it in this tab."
          bodyClassName="space-y-3"
        >
          <div className="space-y-2">
            {numbers.map((n) => {
              const state = stateFor(n);
              const badge = NUMBER_BADGE[state];
              const isSelected = n.id === selected;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setSelected(n.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:border-foreground/20",
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      {state === "connected" ? (
                        <CheckCircle size={13} className="shrink-0 text-emerald-500" />
                      ) : null}
                      <span className="truncate font-medium tabular-nums text-foreground">
                        {n.phoneNumber}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {state === "in_use"
                        ? `In use in ${occupancy[n.id]?.device ?? "another tab"}`
                        : `${n.connectionName ?? "no connection"} · ${n.assignmentStatus}`}
                    </span>
                  </span>
                  <AnimatedBadge size="sm" status={badge.status}>
                    {badge.label}
                  </AnimatedBadge>
                </button>
              );
            })}
            {numbers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No numbers discovered.</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {registered ? (
                <>
                  This tab: <span className="text-foreground">{connectedNumber?.phoneNumber}</span>
                </>
              ) : (
                "No number connected in this tab"
              )}
            </span>
            {selectedIsConnected ? (
              <Button size="sm" variant="secondary" onClick={disconnect}>
                Disconnect
              </Button>
            ) : selectedState === "in_use" ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void forceTakeover()}
              >
                {busy ? "Taking over…" : "Force disconnect"}
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !selected || selectedState === "connecting"}
                onClick={() => void connect()}
              >
                {busy || selectedState === "connecting"
                  ? "Connecting…"
                  : registered
                    ? "Switch"
                    : "Connect"}
              </Button>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            One number per tab — connecting another releases the current one.
            {hasUnassigned
              ? " “Needs assignment” numbers can’t receive inbound calls; assign them in Settings."
              : ""}
          </p>
        </Panel>

        <div className="space-y-4">
          <Panel
            title="Dial"
            description={
              registered
                ? `Calling as ${dialerNumber?.phoneNumber ?? "—"}`
                : "Connect a number to place calls"
            }
            bodyClassName="space-y-4"
          >
            {registered && quickDial.length > 0 ? (
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  On-net quick dial
                </p>
                <div className="flex flex-wrap gap-2">
                  {quickDial.map(({ number: n, state }) => {
                    const isActive = destination === n.phoneNumber;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        title={state === "in_use" ? "Connected in another tab" : undefined}
                        onClick={() => setDestination(n.phoneNumber)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs tabular-nums transition-colors",
                          isActive
                            ? "border-primary/50 bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", QUICK_DOT[state])} />
                        {n.phoneNumber}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="flex gap-2">
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void placeCall()}
                inputMode="tel"
                placeholder="+E.164 destination"
                aria-invalid={selfCall}
                className={cn(
                  "h-11 min-w-0 flex-1 rounded-full border bg-background px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:ring-2 sm:h-10",
                  selfCall
                    ? "border-destructive/60 focus-visible:ring-destructive/30"
                    : "border-border focus-visible:ring-ring/40",
                )}
              />
              <Button
                className="h-11 shrink-0 sm:h-10"
                disabled={!registered || !destination || selfCall}
                onClick={() => void placeCall()}
              >
                <CallOutgoing size={15} /> Call
              </Button>
            </div>

            {selfCall ? (
              <p className="text-xs text-destructive">
                This tab is connected as{" "}
                <span className="tabular-nums">{connectedNumber?.phoneNumber}</span>. Choose a
                different destination.
              </p>
            ) : null}

            <div className="space-y-2">
              {active.map((call) => {
                const warning = telnyx.warnings[call.id];
                return (
                <div
                  key={call.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5",
                    warning ? "border-amber-500/40 bg-amber-500/5" : "border-border",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-sm">
                      <span className="font-medium capitalize text-foreground">{call.direction}</span>
                      <span className="text-muted-foreground"> · {call.state}</span>
                    </span>
                    {warning ? (
                      <span className="mt-0.5 flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                        <Warning size={12} className="mt-0.5 shrink-0" />
                        <span className="min-w-0">
                          {warning.message}
                          {warning.solutions[0] ? (
                            <span className="text-muted-foreground"> — {warning.solutions[0]}</span>
                          ) : null}
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={call.isAudioMuted ? "Unmute" : "Mute"}
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => (call.isAudioMuted ? call.unmuteAudio() : call.muteAudio())}
                    >
                      {call.isAudioMuted ? <MicrophoneSlash size={15} /> : <Microphone size={15} />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={call.state === "held" ? "Resume" : "Hold"}
                      className="h-10 w-10 sm:h-8 sm:w-8"
                      onClick={() => (call.state === "held" ? call.unhold() : call.hold())}
                    >
                      {call.state === "held" ? <Play size={15} /> : <Pause size={15} />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10 text-destructive hover:text-destructive sm:h-8 sm:w-8"
                      aria-label="Hang up"
                      onClick={() => void call.hangup()}
                    >
                      <PhoneHangup size={15} />
                    </Button>
                  </div>
                </div>
                );
              })}
              {active.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active calls.</p>
              ) : null}
            </div>
          </Panel>

          <Panel
            title="Today"
            actions={
              <Button size="sm" variant="ghost" onClick={refresh}>
                <Refresh size={14} /> Refresh
              </Button>
            }
            bodyClassName="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label="Cost"
                value={data?.cost.totalCost ?? 0}
                tone="success"
                icon={<Coin size={16} />}
                decimals={4}
                format={(n) => formatMoney(n, data?.cost.currency ?? null)}
              />
              <StatCard
                label="Calls"
                value={data?.cost.callCount ?? 0}
                tone="info"
                icon={<Call size={16} />}
              />
              <StatCard
                label="Talk time"
                value={data?.cost.totalDurationSecs ?? 0}
                icon={<Clock size={16} />}
                decimals={0}
                format={(n) => formatDuration(n)}
              />
            </div>

            <div className="space-y-1">
              {(data?.recentCalls ?? []).slice(0, 6).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm"
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {c.direction === "inbound" ? (
                      <CallIncoming size={14} />
                    ) : (
                      <CallOutgoing size={14} />
                    )}
                    <span className="capitalize text-foreground">{c.direction}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{formatTime(c.startedAt)}</span>
                  <span className="tabular-nums text-foreground">
                    {formatMoney(c.cost, c.currency)}
                  </span>
                </div>
              ))}
              {(data?.recentCalls ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No calls yet.</p>
              ) : null}
            </div>
          </Panel>
        </div>
      </div>

      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      {telnyx.error ? <p className="text-sm text-destructive">{telnyx.error}</p> : null}
      {!data ? <LoadingBlock label="Loading overview" /> : null}
    </section>
  );
}
