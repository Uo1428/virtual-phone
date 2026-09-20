import { useCallback, useEffect, useState } from "react";
import type { SessionDto } from "@virtual-phone/shared";
import { api } from "../api/client";

export interface UseAuthResult {
  session: SessionDto | null;
  loading: boolean;
  login: (passcode?: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [session, setSession] = useState<SessionDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (passcode?: string) => {
    const created = await api.login(passcode);
    setSession(created);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setSession(null);
  }, []);

  return { session, loading, login, logout };
}
