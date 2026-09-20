import type {
  CallDto,
  CallEventDto,
  CallTimelineDto,
  CostSummaryDto,
  NumberDto,
  NumbersResponseDto,
  OverviewDto,
  SessionDto,
  TokenResponseDto,
} from "@virtual-phone/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  session: () => request<SessionDto>("/api/auth/session"),
  login: (passcode?: string) =>
    request<SessionDto>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ passcode }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  numbers: () => request<NumbersResponseDto>("/api/numbers"),
  overview: () => request<OverviewDto>("/api/overview"),
  costSummary: (range: CostSummaryDto["range"] = "today") =>
    request<CostSummaryDto>(`/api/cost/summary?range=${range}`),
  release: (tabId: string, numberId?: string) =>
    request<{ ok: boolean }>("/api/webrtc/release", {
      method: "POST",
      body: JSON.stringify({ tabId, numberId }),
    }),
  assignNumber: (numberId: string) =>
    request<{ number: NumberDto }>(`/api/numbers/${numberId}/assign`, { method: "POST" }),
  token: (numberId: string, tabId: string, device?: string) =>
    request<TokenResponseDto>("/api/webrtc/token", {
      method: "POST",
      body: JSON.stringify({ numberId, tabId, device }),
    }),
  refresh: (numberId: string, tabId: string, device?: string) =>
    request<TokenResponseDto>("/api/webrtc/refresh", {
      method: "POST",
      body: JSON.stringify({ numberId, tabId, device }),
    }),
  heartbeat: (tabId: string, numberId?: string) =>
    request<{ ok: boolean; registered: boolean }>("/api/webrtc/heartbeat", {
      method: "POST",
      body: JSON.stringify({ tabId, numberId }),
    }),
  takeover: (numberId: string) =>
    request<{ ok: boolean; revoked: number }>("/api/webrtc/takeover", {
      method: "POST",
      body: JSON.stringify({ numberId }),
    }),
  unregister: (tabId: string) =>
    fetch(`/api/webrtc/register?tabId=${encodeURIComponent(tabId)}`, {
      method: "DELETE",
      credentials: "same-origin",
      keepalive: true,
    }),
  startOutbound: (numberId: string, destination: string) =>
    request<CallDto>("/api/calls/outbound", {
      method: "POST",
      body: JSON.stringify({ numberId, destination }),
    }),
  updateCallStatus: (
    id: string,
    body: {
      state: "initiated" | "ringing" | "active" | "ended" | "failed";
      telnyxSessionId?: string | null;
      telnyxCallControlId?: string | null;
      telnyxLegId?: string | null;
      hangupCause?: string | null;
    },
  ) =>
    request<{ ok: boolean }>(`/api/calls/${id}/status`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  listCalls: (limit = 50) => request<{ calls: CallDto[] }>(`/api/calls?limit=${limit}`),
  getCall: (id: string) => request<CallDto>(`/api/calls/${id}`),
  callTimeline: (id: string) => request<CallTimelineDto>(`/api/calls/${id}/timeline`),
  reconcileCall: (id: string) =>
    request<{ ok: boolean; reconciled: boolean }>(`/api/calls/${id}/reconcile`, {
      method: "POST",
    }),
  listEvents: (limit = 200) =>
    request<{ events: CallEventDto[] }>(`/api/events?limit=${limit}`),
  webrtcStatus: () =>
    request<{
      registrations: Array<{
        credentialId: string;
        sipUsername: string;
        numberId: string;
        tabId: string;
        createdAt: string;
        lastSeenAt: string;
        online: boolean;
      }>;
    }>("/api/webrtc/status"),
  refreshDiscovery: () =>
    request<{ warnings: string[] }>("/api/discovery/refresh", { method: "POST" }),
};
