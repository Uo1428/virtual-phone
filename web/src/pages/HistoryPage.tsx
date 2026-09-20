import {
  CallIncoming,
  CallOutgoing,
  Clock,
  PageHeader,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@virtual-phone/ui";
import type { CallDto, CostSummaryDto } from "@virtual-phone/shared";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { formatDateTime, formatDuration, formatMoney } from "../lib/format";

const RANGES: Array<{ value: CostSummaryDto["range"]; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

function DirectionCell({ call }: { call: CallDto }) {
  const inbound = call.direction === "inbound";
  return (
    <span className="flex items-center gap-2">
      <span className="text-muted-foreground">
        {inbound ? <CallIncoming size={14} /> : <CallOutgoing size={14} />}
      </span>
      <span className="capitalize">{call.direction}</span>
    </span>
  );
}

export function HistoryPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<CostSummaryDto["range"]>("today");
  const [direction, setDirection] = useState<"all" | "inbound" | "outbound">("all");
  const { data, loading, error } = usePolling(() => api.listCalls(200), 5000);
  const { data: cost } = usePolling(() => api.costSummary(range), 5000);

  const calls = (data?.calls ?? []).filter(
    (c) => direction === "all" || c.direction === direction,
  );

  return (
    <section className="space-y-6">
      <PageHeader
        icon={<Clock size={20} />}
        title="Call history"
        description="Every call the server has recorded, with reconciled cost and duration."
        actions={
          <Select value={range} onValueChange={(v) => setRange(v as CostSummaryDto["range"])}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Range" />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Cost</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {formatMoney(cost?.totalCost ?? null, cost?.currency ?? null)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Calls</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {cost?.callCount ?? 0}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Talk time</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {formatDuration(cost?.totalDurationSecs ?? 0)}
          </p>
        </div>
      </div>

      <Panel
        title="Calls"
        actions={
          <Tabs
            value={direction}
            onValueChange={(v) => setDirection(v as typeof direction)}
            variant="segment"
            className="min-w-0"
          >
            <TabsList className="max-w-full overflow-x-auto">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="inbound">Inbound</TabsTrigger>
              <TabsTrigger value="outbound">Outbound</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-border md:hidden">
          {calls.map((call) => {
            const inbound = call.direction === "inbound";
            return (
              <li key={call.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/history/${call.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-secondary/50"
                >
                  <span
                    className={
                      inbound
                        ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"
                        : "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                    }
                  >
                    {inbound ? <CallIncoming size={16} /> : <CallOutgoing size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {inbound ? call.from ?? "—" : call.to ?? "—"}
                    </span>
                    <span className="block truncate text-xs capitalize text-muted-foreground">
                      {call.state} · {formatDuration(call.durationSecs)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums text-foreground">
                      {formatMoney(call.cost, call.currency)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {formatDateTime(call.startedAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Direction</th>
                <th className="px-5 py-2.5 font-medium">From</th>
                <th className="px-5 py-2.5 font-medium">To</th>
                <th className="px-5 py-2.5 font-medium">State</th>
                <th className="px-5 py-2.5 font-medium">Duration</th>
                <th className="px-5 py-2.5 font-medium">Cost</th>
                <th className="px-5 py-2.5 font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr
                  key={call.id}
                  onClick={() => navigate(`/history/${call.id}`)}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-secondary/50"
                >
                  <td className="px-5 py-2.5">
                    <DirectionCell call={call} />
                  </td>
                  <td className="px-5 py-2.5 tabular-nums text-muted-foreground">
                    {call.from ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 tabular-nums text-muted-foreground">
                    {call.to ?? "—"}
                  </td>
                  <td className="px-5 py-2.5 capitalize">{call.state}</td>
                  <td className="px-5 py-2.5 tabular-nums">{formatDuration(call.durationSecs)}</td>
                  <td className="px-5 py-2.5 tabular-nums">
                    {formatMoney(call.cost, call.currency)}
                  </td>
                  <td className="px-5 py-2.5 text-muted-foreground">
                    {formatDateTime(call.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {loading && calls.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">Loading…</p>
        ) : null}
        {!loading && calls.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No calls yet.</p>
        ) : null}
        {error ? <p className="px-4 py-4 text-sm text-destructive sm:px-5">{error}</p> : null}
      </Panel>
    </section>
  );
}
