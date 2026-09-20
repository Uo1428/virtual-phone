import { useEffect, useRef, useState } from "react";
import type { CallEventDto } from "@virtual-phone/shared";

const MAX = 200;

export function useEventStream(enabled: boolean): CallEventDto[] {
  const [events, setEvents] = useState<CallEventDto[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events/stream");
    source.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as CallEventDto;
        setEvents((prev) => [...prev, parsed].slice(-MAX));
      } catch {
        // ignore malformed frames
      }
    });
    return () => source.close();
  }, [enabled]);

  return events;
}

export interface StateEvent {
  type: string;
  numberId?: string;
  tabId?: string;
  device?: string | null;
}

/**
 * Fire `onState` whenever the server pushes a state change (occupancy,
 * takeover), so the UI reacts without waiting for a poll.
 */
export function useStateStream(onState?: (event: StateEvent) => void): void {
  const ref = useRef(onState);
  ref.current = onState;

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    const handler = (event: Event) => {
      try {
        ref.current?.(JSON.parse((event as MessageEvent).data) as StateEvent);
      } catch {
        // ignore malformed frames
      }
    };
    source.addEventListener("state", handler);
    return () => {
      source.removeEventListener("state", handler);
      source.close();
    };
  }, []);
}
