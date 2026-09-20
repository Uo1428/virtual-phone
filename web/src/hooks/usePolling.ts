import { useCallback, useEffect, useRef, useState } from "react";

export interface PollingResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Poll an async function on an interval; keeps the last good value. */
export function usePolling<T>(fn: () => Promise<T>, intervalMs: number): PollingResult<T> {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const result = await fnRef.current();
        if (!alive) return;
        setData(result);
        setError(null);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    const id = window.setInterval(run, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [intervalMs, tick]);

  return { data, error, loading, refresh };
}
