import Telnyx from "telnyx";
import { env } from "../env";

type TelnyxClient = InstanceType<typeof Telnyx>;

let client: TelnyxClient | null = null;

/** Returns a Telnyx client when an API key is configured, otherwise null. */
export function getTelnyx(): TelnyxClient | null {
  if (!env.TELNYX_API_KEY) return null;
  if (!client) {
    client = new Telnyx({
      apiKey: env.TELNYX_API_KEY,
      publicKey: env.TELNYX_PUBLIC_KEY,
    });
  }
  return client;
}

export function requireTelnyx(): TelnyxClient {
  const c = getTelnyx();
  if (!c) throw new Error("TELNYX_API_KEY is not configured");
  return c;
}
