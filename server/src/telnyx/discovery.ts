import crypto from "node:crypto";
import type { NumberDto } from "@virtual-phone/shared";
import { env } from "../env";
import { requireTelnyx } from "../telnyx/client";
import { getDb, mutate } from "../db/db";
import type { DiscoveredApp, DiscoveredConnection } from "../db/db";
import { logger } from "../log/logger";
import { recordEvent } from "../events/eventStore";

export interface DiscoveryResult {
  callControlApp: DiscoveredApp | null;
  credentialConnection: DiscoveredConnection | null;
  outboundVoiceProfile: { id: string; name: string } | null;
  numbers: NumberDto[];
  warnings: string[];
}

function randomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

function webhookUrl(): string | null {
  if (!env.PUBLIC_URL) return null;
  return `${env.PUBLIC_URL.replace(/\/$/, "")}/api/telnyx/webhooks`;
}

async function ensureOutboundVoiceProfile(): Promise<{
  profile: { id: string; name: string } | null;
  warnings: string[];
}> {
  const client = requireTelnyx();
  const warnings: string[] = [];

  if (env.TELNYX_OUTBOUND_VOICE_PROFILE_ID) {
    const found = await client.outboundVoiceProfiles.retrieve(
      env.TELNYX_OUTBOUND_VOICE_PROFILE_ID,
    );
    if (found.data) {
      return { profile: { id: found.data.id ?? "", name: found.data.name }, warnings };
    }
    warnings.push("Pinned outbound voice profile not found; falling back to discovery.");
  }

  for await (const profile of client.outboundVoiceProfiles.list()) {
    if (profile.enabled !== false) {
      return { profile: { id: profile.id ?? "", name: profile.name }, warnings };
    }
  }

  if (!env.TELNYX_PROVISION) {
    warnings.push("No outbound voice profile found. Create one or set TELNYX_PROVISION=true.");
    return { profile: null, warnings };
  }

  const created = await client.outboundVoiceProfiles.create({
    name: "virtual-phone-outbound",
    enabled: true,
  });
  logger.info("discovery_created_outbound_profile", { id: created.data?.id });
  if (!created.data?.id) {
    warnings.push("Failed to create outbound voice profile.");
    return { profile: null, warnings };
  }
  return { profile: { id: created.data.id, name: created.data.name }, warnings };
}

async function ensureCallControlApp(): Promise<{ app: DiscoveredApp | null; warnings: string[] }> {
  const client = requireTelnyx();
  const warnings: string[] = [];
  const url = webhookUrl();

  if (env.TELNYX_CALL_CONTROL_APP_ID) {
    const found = await client.callControlApplications.retrieve(env.TELNYX_CALL_CONTROL_APP_ID);
    if (found.data) {
      const app = toDiscoveredApp(found.data);
      await applyAppSettings(app);
      return { app, warnings };
    }
    warnings.push("Pinned call control application not found; falling back to discovery.");
  }

  let candidate: DiscoveredApp | null = null;
  for await (const app of client.callControlApplications.list()) {
    const discovered = toDiscoveredApp(app);
    if (url && discovered.webhookEventUrl === url) {
      candidate = discovered;
      break;
    }
    if (!candidate) candidate = discovered;
  }

  if (!candidate) {
    if (!url) {
      warnings.push("No call control application and no PUBLIC_URL to create one.");
      return { app: null, warnings };
    }
    if (!env.TELNYX_PROVISION) {
      warnings.push("No call control application found. Set TELNYX_PROVISION=true to create one.");
      return { app: null, warnings };
    }
    const created = await client.callControlApplications.create({
      application_name: "virtual-phone",
      webhook_event_url: url,
      webhook_api_version: "2",
      call_cost_in_webhooks: true,
    });
    logger.info("discovery_created_call_control_app", { id: created.data?.id });
    if (!created.data) {
      warnings.push("Failed to create call control application.");
      return { app: null, warnings };
    }
    return { app: toDiscoveredApp(created.data), warnings };
  }

  await applyAppSettings(candidate);
  return { app: candidate, warnings };
}

function toDiscoveredApp(app: {
  id?: string;
  application_name?: string;
  webhook_event_url?: string | null;
  call_cost_in_webhooks?: boolean;
}): DiscoveredApp {
  return {
    id: app.id ?? "",
    applicationName: app.application_name ?? "",
    webhookEventUrl: app.webhook_event_url ?? null,
    callCostInWebhooks: app.call_cost_in_webhooks ?? false,
  };
}

async function applyAppSettings(app: DiscoveredApp): Promise<void> {
  if (!app.id) return;
  const client = requireTelnyx();
  const url = webhookUrl();
  const needsUrl = Boolean(url && app.webhookEventUrl !== url);
  const needsCost = !app.callCostInWebhooks;
  if (!needsUrl && !needsCost) return;

  await client.callControlApplications.update(app.id, {
    application_name: app.applicationName || "virtual-phone",
    webhook_event_url: url ?? app.webhookEventUrl ?? "",
    call_cost_in_webhooks: true,
  });
  if (needsUrl) {
    app.webhookEventUrl = url;
    logger.info("discovery_updated_webhook_url", { appId: app.id, url });
  }
  app.callCostInWebhooks = true;
  logger.info("discovery_app_settings_applied", { appId: app.id });
}

async function ensureCredentialConnection(
  outboundVoiceProfileId: string | null,
): Promise<{ connection: DiscoveredConnection | null; warnings: string[] }> {
  const client = requireTelnyx();
  const warnings: string[] = [];

  const applySettings = async (id: string) => {
    await client.credentialConnections.update(id, {
      connection_name: "virtual-phone-webrtc",
      sip_uri_calling_preference: "internal",
      call_cost_in_webhooks: false,
      ...(outboundVoiceProfileId
        ? { outbound: { outbound_voice_profile_id: outboundVoiceProfileId } }
        : {}),
    });
  };

  if (env.TELNYX_CREDENTIAL_CONNECTION_ID) {
    const found = await client.credentialConnections.retrieve(
      env.TELNYX_CREDENTIAL_CONNECTION_ID,
    );
    if (found.data) {
      await applySettings(env.TELNYX_CREDENTIAL_CONNECTION_ID);
      return { connection: toDiscoveredConnection(found.data), warnings };
    }
    warnings.push("Pinned credential connection not found; falling back to discovery.");
  }

  for await (const conn of client.credentialConnections.list()) {
    const discovered = toDiscoveredConnection(conn);
    if (discovered.sipUriCallingPreference !== "internal") {
      await applySettings(discovered.id);
      discovered.sipUriCallingPreference = "internal";
    }
    return { connection: discovered, warnings };
  }

  if (!env.TELNYX_PROVISION) {
    warnings.push("No credential connection found. Set TELNYX_PROVISION=true to create one.");
    return { connection: null, warnings };
  }

  const created = await client.credentialConnections.create({
    connection_name: "virtual-phone-webrtc",
    user_name: `vp${randomToken(6)}`,
    password: randomToken(16),
    sip_uri_calling_preference: "internal",
    call_cost_in_webhooks: false,
    ...(outboundVoiceProfileId
      ? { outbound: { outbound_voice_profile_id: outboundVoiceProfileId } }
      : {}),
  });
  logger.info("discovery_created_credential_connection", { id: created.data?.id });
  if (!created.data) {
    warnings.push("Failed to create credential connection.");
    return { connection: null, warnings };
  }
  return { connection: toDiscoveredConnection(created.data), warnings };
}

function toDiscoveredConnection(conn: {
  id?: string;
  connection_name?: string;
  user_name?: string;
  sip_uri_calling_preference?: string | null;
}): DiscoveredConnection {
  return {
    id: conn.id ?? "",
    connectionName: conn.connection_name ?? "",
    sipUsername: conn.user_name ?? null,
    sipUriCallingPreference: conn.sip_uri_calling_preference ?? null,
  };
}

async function syncNumbers(callControlAppId: string | null): Promise<{
  numbers: NumberDto[];
  warnings: string[];
}> {
  const client = requireTelnyx();
  const warnings: string[] = [];
  const numbers: NumberDto[] = [];

  for await (const number of client.phoneNumbers.list()) {
    const assignedToCallControl = Boolean(
      callControlAppId && number.connection_id === callControlAppId,
    );
    numbers.push({
      id: number.id ?? "",
      phoneNumber: number.phone_number ?? "",
      connectionId: number.connection_id ?? null,
      connectionName: number.connection_name ?? null,
      status: number.status ?? null,
      assignedToCallControl,
      assignmentStatus: assignedToCallControl ? "assigned" : callControlAppId ? "needs_manual" : "unknown",
      supportsInbound: assignedToCallControl,
    });
  }

  if (numbers.some((n) => n.assignmentStatus === "needs_manual")) {
    warnings.push(
      "Some numbers are not assigned to the call control app. Assign them from Settings.",
    );
  }
  return { numbers, warnings };
}

/** Assign a single owned number to the discovered Call Control app. */
export async function assignNumberToApp(numberId: string): Promise<NumberDto> {
  const client = requireTelnyx();
  const db = await getDb();
  const app = db.data.callControlApp;
  if (!app?.id) throw new Error("Call control app not discovered yet");

  const number = db.data.numbers.find((n) => n.id === numberId);
  if (!number) throw new Error("Unknown number");

  await client.phoneNumbers.update(numberId, { connection_id: app.id });

  const updated: NumberDto = {
    ...number,
    connectionId: app.id,
    connectionName: app.applicationName,
    assignedToCallControl: true,
    assignmentStatus: "assigned",
    supportsInbound: true,
  };
  await mutate((data) => {
    const row = data.numbers.find((n) => n.id === numberId);
    if (row) Object.assign(row, updated);
  });

  logger.info("number_assigned", { numberId, phoneNumber: number.phoneNumber, appId: app.id });
  void recordEvent({
    source: "system",
    type: "number_assigned",
    message: `${number.phoneNumber} assigned to ${app.applicationName}`,
  });
  return updated;
}

export async function runDiscovery(): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  const ovp = await ensureOutboundVoiceProfile();
  warnings.push(...ovp.warnings);

  const app = await ensureCallControlApp();
  warnings.push(...app.warnings);

  const conn = await ensureCredentialConnection(ovp.profile?.id ?? null);
  warnings.push(...conn.warnings);

  const numbers = await syncNumbers(app.app?.id ?? null);
  warnings.push(...numbers.warnings);

  const result: DiscoveryResult = {
    callControlApp: app.app,
    credentialConnection: conn.connection,
    outboundVoiceProfile: ovp.profile,
    numbers: numbers.numbers,
    warnings,
  };

  await mutate((data) => {
    data.callControlApp = result.callControlApp;
    data.credentialConnection = result.credentialConnection;
    data.outboundVoiceProfile = result.outboundVoiceProfile;
    data.numbers = result.numbers;
    data.settings.callControlAppId = result.callControlApp?.id ?? null;
    data.settings.credentialConnectionId = result.credentialConnection?.id ?? null;
    data.settings.outboundVoiceProfileId = result.outboundVoiceProfile?.id ?? null;
    data.settings.lastDiscoveryAt = new Date().toISOString();
  });

  logger.info("discovery_complete", {
    callControlAppId: result.callControlApp?.id ?? null,
    credentialConnectionId: result.credentialConnection?.id ?? null,
    numberCount: result.numbers.length,
    warningCount: warnings.length,
  });
  void recordEvent({
    source: "system",
    type: "discovery_complete",
    message: `discovered ${result.numbers.length} number(s)`,
    level: warnings.length ? "warn" : "info",
    raw: warnings,
  });

  return result;
}

/** Best-effort discovery at boot; never crashes the server. */
export async function runDiscoveryOnBoot(): Promise<void> {
  if (!env.TELNYX_API_KEY) {
    logger.warn("discovery_skipped", { reason: "no_api_key" });
    return;
  }
  try {
    await runDiscovery();
  } catch (error) {
    logger.error("discovery_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
