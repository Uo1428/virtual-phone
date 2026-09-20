import {
  ArrowLeft,
  CallIncoming,
  CallOutgoing,
  Clock,
  Coin,
  PageHeader,
  Panel,
  Refresh,
  Timer,
} from "@virtual-phone/ui";
import { type ReactNode, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import {
  formatDateTime,
  formatDelta,
  formatDuration,
  formatMoney,
  formatOffset,
} from "../lib/format";

const LEVEL_CLASS: Record<string, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{children}</p>
    </div>
  );
}

export function CallDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refresh } = usePolling(() => api.callTimeline(id), 3000);
  const [reconciling, setReconciling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const call = data?.call;
  const entries = data?.entries ?? [];

  const reconcile = async () => {
    setReconciling(true);
    setNote(null);
    try {
      const result = await api.reconcileCall(id);
      setNote(result.reconciled ? "Cost updated from Telnyx CDRs." : "No matching CDR yet.");
      refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setReconciling(false);
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        icon={<Clock size={20} />}
        title="Call detail"
        description={call ? `${call.from ?? "—"} → ${call.to ?? "—"}` : "Loading timeline…"}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/history")}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm text-foreground transition-colors hover:border-foreground/20"
            >
              <ArrowLeft size={15} /> Back
            </button>
            <button
              type="button"
              disabled={reconciling}
              onClick={() => void reconcile()}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Refresh size={15} /> {reconciling ? "Reconciling…" : "Reconcile cost"}
            </button>
          </div>
        }
      />

      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {loading && !call ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {call ? (
        <>
          <Panel title="Summary">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Direction">
                <span className="flex items-center gap-2 capitalize">
                  {call.direction === "inbound" ? (
                    <CallIncoming size={14} />
                  ) : (
                    <CallOutgoing size={14} />
                  )}
                  {call.direction}
                </span>
              </Fact>
              <Fact label="State">
                <span className="capitalize">{call.state}</span>
              </Fact>
              <Fact label="Duration">
                <span className="flex items-center gap-2 tabular-nums">
                  <Timer size={14} /> {formatDuration(call.durationSecs)}
                </span>
              </Fact>
              <Fact label="Cost">
                <span className="flex items-center gap-2 tabular-nums">
                  <Coin size={14} /> {formatMoney(call.cost, call.currency)}
                </span>
              </Fact>
              <Fact label="Hangup cause">{call.hangupCause ?? "—"}</Fact>
              <Fact label="Started">
                <span className="tabular-nums">{formatDateTime(call.startedAt)}</span>
              </Fact>
            </div>
          </Panel>

          <Panel title="Legs" bodyClassName="p-0">
            <ul className="divide-y divide-border md:hidden">
              {call.legs.map((leg) => (
                <li key={leg.callControlId} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm capitalize text-foreground">{leg.role}</span>
                    <span className="text-sm tabular-nums text-foreground">
                      {formatMoney(leg.cost ?? null, leg.currency ?? call.currency)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {leg.callControlId}
                  </p>
                  <p className="text-xs capitalize text-muted-foreground">{leg.state}</p>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Role</th>
                    <th className="px-5 py-2.5 font-medium">Call Control ID</th>
                    <th className="px-5 py-2.5 font-medium">State</th>
                    <th className="px-5 py-2.5 font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {call.legs.map((leg) => (
                    <tr key={leg.callControlId} className="border-t border-border">
                      <td className="px-5 py-2.5 capitalize">{leg.role}</td>
                      <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">
                        {leg.callControlId}
                      </td>
                      <td className="px-5 py-2.5 capitalize">{leg.state}</td>
                      <td className="px-5 py-2.5 tabular-nums">
                        {formatMoney(leg.cost ?? null, leg.currency ?? call.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {call.legs.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No legs recorded.</p>
            ) : null}
          </Panel>

          <Panel title="Recorder log" bodyClassName="p-0">
            <ul className="max-h-[60vh] divide-y divide-border overflow-auto font-mono text-xs">
              {entries.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-col gap-0.5 px-4 py-2 sm:grid sm:grid-cols-[9rem_13rem_1fr] sm:gap-3 sm:px-5"
                >
                  <span className="text-muted-foreground tabular-nums">{formatOffset(e.offsetMs)}</span>
                  <span className="text-primary/80 tabular-nums">
                    +{formatDelta(e.deltaMs)} · {e.source}
                  </span>
                  <span className={LEVEL_CLASS[e.level] ?? "text-foreground"}>
                    <strong className="font-semibold">{e.type}</strong> — {e.message}
                  </span>
                </li>
              ))}
            </ul>
            {entries.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
                No events recorded for this call.
              </p>
            ) : null}
          </Panel>
        </>
      ) : null}
    </section>
  );
}
