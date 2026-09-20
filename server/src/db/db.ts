import { JSONFilePreset } from "lowdb/node";
import type { Low } from "lowdb";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env";
import type { CallDto, CallEventDto, NumberDto } from "@virtual-phone/shared";

export interface DiscoveredApp {
  id: string;
  applicationName: string;
  webhookEventUrl: string | null;
  callCostInWebhooks: boolean;
}

export interface DiscoveredConnection {
  id: string;
  connectionName: string;
  sipUsername: string | null;
  sipUriCallingPreference: string | null;
}

export interface Registration {
  credentialId: string;
  sipUsername: string;
  numberId: string;
  sessionId: string;
  tabId: string;
  /** Human-readable holder, e.g. "Chrome · Windows". */
  device: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface SessionRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export interface DbData {
  settings: {
    sessionSecret: string | null;
    callControlAppId: string | null;
    credentialConnectionId: string | null;
    outboundVoiceProfileId: string | null;
    lastDiscoveryAt: string | null;
  };
  numbers: NumberDto[];
  callControlApp: DiscoveredApp | null;
  credentialConnection: DiscoveredConnection | null;
  outboundVoiceProfile: { id: string; name: string } | null;
  registrations: Registration[];
  calls: CallDto[];
  events: CallEventDto[];
  sessions: SessionRecord[];
}

const defaultData: DbData = {
  settings: {
    sessionSecret: null,
    callControlAppId: null,
    credentialConnectionId: null,
    outboundVoiceProfileId: null,
    lastDiscoveryAt: null,
  },
  numbers: [],
  callControlApp: null,
  credentialConnection: null,
  outboundVoiceProfile: null,
  registrations: [],
  calls: [],
  events: [],
  sessions: [],
};

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "../../..");
const dataDir = path.resolve(projectRoot, env.DATA_DIR);
const dbFile = path.join(dataDir, "db.json");

let dbPromise: Promise<Low<DbData>> | null = null;

export function getDb(): Promise<Low<DbData>> {
  if (!dbPromise) {
    dbPromise = JSONFilePreset<DbData>(dbFile, defaultData);
  }
  return dbPromise;
}

let writeChain: Promise<unknown> = Promise.resolve();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const WRITE_DEBOUNCE_MS = 200;

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void getDb()
      .then((db) => db.write())
      .catch(() => undefined);
  }, WRITE_DEBOUNCE_MS);
  writeTimer.unref?.();
}

/** Force any pending debounced write to disk now (shutdown/tests). */
export async function flushWrites(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const db = await getDb();
  await db.write();
}

/**
 * Serialized read-modify-write against the JSON DB. Persistence is debounced
 * (coalesced) so bursts of events don't cause a full-file write per mutation.
 */
export function mutate<T>(fn: (data: DbData) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const db = await getDb();
    const result = await fn(db.data);
    scheduleWrite();
    return result;
  });
  writeChain = run.catch(() => undefined);
  return run;
}

export { dbFile, dataDir };
