import { createContext, useContext, type ReactNode } from "react";
import { useTelnyx, type UseTelnyxResult } from "./useTelnyx";

const TelnyxContext = createContext<UseTelnyxResult | null>(null);

/**
 * Keeps the Telnyx WebRTC client alive for the whole authenticated app, not
 * just the Softphone route. That way an inbound call can ring (and be answered
 * from anywhere) even while the user is on History, Logs or Settings.
 */
export function TelnyxProvider({ children }: { children: ReactNode }) {
  const telnyx = useTelnyx();
  return <TelnyxContext.Provider value={telnyx}>{children}</TelnyxContext.Provider>;
}

export function useTelnyxContext(): UseTelnyxResult {
  const ctx = useContext(TelnyxContext);
  if (!ctx) throw new Error("useTelnyxContext must be used within <TelnyxProvider>");
  return ctx;
}
