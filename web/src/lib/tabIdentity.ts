const TAB_KEY = "vp_tab_id";
const CHANNEL = "vp_tab_identity";

let cached: string | null = null;

/** Best-effort "Chrome · Windows" label describing this holder. */
export function deviceLabel(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad|iPod/.test(ua)
          ? "iOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "device";
  return `${browser} · ${os}`;
}

/** Stable per-tab id. Persisted so a reload reuses the same identity. */
export function getTabId(): string {
  if (cached) return cached;
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(TAB_KEY);
  } catch {
    id = null;
  }
  if (!id) {
    id = crypto.randomUUID();
    try {
      sessionStorage.setItem(TAB_KEY, id);
    } catch {
      // storage unavailable — the in-memory id still works for this context
    }
  }
  cached = id;
  return id;
}

/**
 * Browsers copy `sessionStorage` when a tab is duplicated, so two contexts can
 * share a tab id. The server then treats them as one tab (it excludes the
 * caller's own session+tab) and lets both connect the same number.
 *
 * Announce the id over a BroadcastChannel; if another context claims the same
 * id, the loser of a deterministic nonce comparison takes a fresh one.
 */
export function watchTabIdentity(onChange: (id: string) => void): () => void {
  const nonce = crypto.randomUUID();
  let id = getTabId();

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch {
    return () => {};
  }

  const announce = () => channel.postMessage({ type: "hello", id, nonce });

  channel.onmessage = (event: MessageEvent) => {
    const msg = event.data as { type?: string; id?: string; nonce?: string } | null;
    if (!msg || msg.type !== "hello" || !msg.id || msg.id !== id) return;

    if ((msg.nonce ?? "") < nonce) {
      // Another context owns this id — take a fresh one.
      id = crypto.randomUUID();
      cached = id;
      try {
        sessionStorage.setItem(TAB_KEY, id);
      } catch {
        // ignore
      }
      announce();
      onChange(id);
    } else {
      // We keep the id; re-announce so the other context sees our nonce.
      announce();
    }
  };

  announce();

  return () => {
    channel.onmessage = null;
    channel.close();
  };
}
