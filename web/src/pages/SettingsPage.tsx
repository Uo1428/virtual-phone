import {
  AnimatedBadge,
  Button,
  MonitorPhone,
  PageHeader,
  Panel,
  Refresh,
  Settings,
  Shield,
} from "@virtual-phone/ui";
import { type ReactNode, useState } from "react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { formatDateTime } from "../lib/format";

interface AppInfo {
  id?: string;
  applicationName?: string;
  webhookEventUrl?: string | null;
  callCostInWebhooks?: boolean;
}

interface ConnInfo {
  id?: string;
  connectionName?: string;
  sipUriCallingPreference?: string | null;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-foreground">{children}</span>
    </div>
  );
}

export function SettingsPage() {
  const { data, refresh } = usePolling(() => api.overview(), 10000);
  const { data: status } = usePolling(() => api.webrtcStatus(), 10000);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  const app = (data?.discovery.callControlApp ?? null) as AppInfo | null;
  const conn = (data?.discovery.credentialConnection ?? null) as ConnInfo | null;

  const refreshDiscovery = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.refreshDiscovery();
      setMessage(
        result.warnings.length ? `Warnings: ${result.warnings.join("; ")}` : "Discovery refreshed.",
      );
      refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const assign = async (numberId: string, phoneNumber: string) => {
    setAssigning(numberId);
    setAssignMessage(null);
    try {
      await api.assignNumber(numberId);
      setAssignMessage(`${phoneNumber} assigned to the Call Control app.`);
      refresh();
    } catch (e) {
      setAssignMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setAssigning(null);
    }
  };

  return (
    <section className="space-y-6">
      <PageHeader
        icon={<Settings size={20} />}
        title="Settings"
        description="Telnyx resources discovered for this account and the numbers they cover."
        actions={
          <Button variant="secondary" disabled={busy} onClick={() => void refreshDiscovery()}>
            <Refresh size={15} /> {busy ? "Refreshing…" : "Refresh discovery"}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Telnyx resources" description="Discovered Call Control app and connection">
          <Fact label="Call Control app">
            <span className="flex items-center justify-end gap-2">
              <Shield size={14} className="text-muted-foreground" />
              {app?.applicationName ?? "—"}
            </span>
          </Fact>
          <Fact label="Webhook URL">
            <code className="text-xs">{app?.webhookEventUrl ?? "—"}</code>
          </Fact>
          <Fact label="Cost webhooks">
            <AnimatedBadge size="sm" status={app?.callCostInWebhooks ? "success" : "neutral"}>
              {app?.callCostInWebhooks ? "enabled" : "disabled"}
            </AnimatedBadge>
          </Fact>
          <Fact label="Credential connection">{conn?.connectionName ?? "—"}</Fact>
          <Fact label="SIP URI calling">{conn?.sipUriCallingPreference ?? "—"}</Fact>
          <Fact label="Last discovery">
            <span className="tabular-nums">
              {formatDateTime(data?.discovery.lastDiscoveryAt ?? null)}
            </span>
          </Fact>
          {message ? <p className="pt-2 text-xs text-muted-foreground">{message}</p> : null}
        </Panel>

        <Panel
          title="Number assignment"
          description="Assign a number to enable inbound calls"
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border md:hidden">
            {(data?.numbers ?? []).map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm tabular-nums text-foreground">{n.phoneNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {n.connectionName ?? "—"}
                  </p>
                  <div className="mt-1.5">
                    <AnimatedBadge
                      size="sm"
                      status={n.assignedToCallControl ? "success" : "warning"}
                    >
                      {n.assignmentStatus}
                    </AnimatedBadge>
                  </div>
                </div>
                {!n.assignedToCallControl ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={assigning === n.id}
                    onClick={() => void assign(n.id, n.phoneNumber)}
                  >
                    {assigning === n.id ? "Assigning…" : "Assign"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">Number</th>
                  <th className="px-5 py-2.5 font-medium">Connection</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(data?.numbers ?? []).map((n) => (
                  <tr key={n.id} className="border-t border-border">
                    <td className="px-5 py-2.5 tabular-nums">{n.phoneNumber}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{n.connectionName ?? "—"}</td>
                    <td className="px-5 py-2.5">
                      <AnimatedBadge
                        size="sm"
                        status={n.assignedToCallControl ? "success" : "warning"}
                      >
                        {n.assignmentStatus}
                      </AnimatedBadge>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {!n.assignedToCallControl ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={assigning === n.id}
                          onClick={() => void assign(n.id, n.phoneNumber)}
                        >
                          {assigning === n.id ? "Assigning…" : "Assign to app"}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(data?.numbers ?? []).length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No numbers discovered.</p>
          ) : null}
          {assignMessage ? (
            <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">{assignMessage}</p>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Browser registrations"
        description="WebRTC sessions held by open tabs"
        actions={<MonitorPhone size={16} className="text-muted-foreground" />}
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-border">
          {(status?.registrations ?? []).map((r) => (
            <li
              key={r.credentialId}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 sm:px-5"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                {r.sipUsername.slice(0, 20)}…
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                tab {r.tabId.slice(0, 8)}
              </span>
              <AnimatedBadge size="sm" status={r.online ? "success" : "neutral"}>
                {r.online ? "online" : "offline"}
              </AnimatedBadge>
            </li>
          ))}
        </ul>
        {(status?.registrations ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">
            No registrations for this session.
          </p>
        ) : null}
      </Panel>
    </section>
  );
}
