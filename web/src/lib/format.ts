export function formatMoney(cost: number | null, currency: string | null): string {
  if (cost === null || Number.isNaN(cost)) return "—";
  const cur = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 6,
    }).format(cost);
  } catch {
    return `${cost} ${cur}`;
  }
}

export function formatDuration(secs: number | null): string {
  if (secs === null) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** Relative offset like "+1.234s" or "+123ms" for sub-second. */
export function formatOffset(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(3)}s`;
}

export function formatDelta(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
