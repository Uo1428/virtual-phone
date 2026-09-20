import {
  AnimatedBadge,
  List,
  PageHeader,
  Panel,
  Refresh,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@virtual-phone/ui";
import type { CallEventDto, EventLevel } from "@virtual-phone/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useEventStream } from "../api/useEventStream";
import { formatDateTime } from "../lib/format";

const LEVELS: Array<EventLevel | "all"> = ["all", "info", "warn", "error", "debug"];

const LEVEL_CLASS: Record<EventLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
};

export function LogsPage() {
  const live = useEventStream(true);
  const [initial, setInitial] = useState<CallEventDto[]>([]);
  const [level, setLevel] = useState<EventLevel | "all">("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    api
      .listEvents(200)
      .then((r) => setInitial(r.events))
      .catch(() => undefined);
  }, [tick]);

  const merged = [...initial, ...live];
  const seen = new Set<string>();
  const events = merged
    .filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return level === "all" || e.level === level;
    })
    .slice(-300)
    .reverse();

  return (
    <section className="space-y-6">
      <PageHeader
        icon={<List size={20} />}
        title="Logs"
        description="Live event stream from the server and Telnyx webhooks."
        actions={
          <div className="flex items-center gap-3">
            <AnimatedBadge status="success" pulse>
              live
            </AnimatedBadge>
            <button
              type="button"
              onClick={() => setTick((t) => t + 1)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Refresh size={14} /> Reload
            </button>
          </div>
        }
      />

      <Panel
        title="Events"
        actions={
          <Tabs
            value={level}
            onValueChange={(v) => setLevel(v as EventLevel | "all")}
            variant="segment"
            className="min-w-0"
          >
            <TabsList className="max-w-full overflow-x-auto">
              {LEVELS.map((l) => (
                <TabsTrigger key={l} value={l} className="capitalize">
                  {l}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        bodyClassName="p-0"
      >
        <ul className="max-h-[70vh] divide-y divide-border overflow-auto font-mono text-xs">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-0.5 px-4 py-2 sm:grid sm:grid-cols-[11rem_12rem_1fr] sm:gap-3 sm:px-5"
            >
              <span className="tabular-nums text-muted-foreground">{formatDateTime(e.at)}</span>
              <span className="truncate text-primary/80">{e.type}</span>
              <span className={LEVEL_CLASS[e.level]}>
                {e.message}
                {e.callId ? (
                  <span className="text-muted-foreground"> · call {e.callId.slice(0, 8)}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {events.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No events.</p>
        ) : null}
      </Panel>
    </section>
  );
}
