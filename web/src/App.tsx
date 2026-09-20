import { FullPageSpinner } from "@virtual-phone/ui";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { IncomingCallOverlay } from "./components/IncomingCallOverlay";
import { useAuth } from "./hooks/useAuth";
import { CallDetailPage } from "./pages/CallDetailPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LoginPage } from "./pages/LoginPage";
import { LogsPage } from "./pages/LogsPage";
import { PhonePage } from "./pages/PhonePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TelnyxProvider } from "./telnyx/TelnyxProvider";

export function App() {
  const auth = useAuth();

  if (auth.loading) {
    return <FullPageSpinner label="Starting session" />;
  }

  if (!auth.session) {
    return <LoginPage onLogin={auth.login} />;
  }

  return (
    <TelnyxProvider>
      <AppShell session={auth.session} onLogout={() => void auth.logout()}>
        <Routes>
          <Route path="/" element={<Navigate to="/phone" replace />} />
          <Route path="/phone" element={<PhonePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<CallDetailPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/phone" replace />} />
        </Routes>
      </AppShell>
      <IncomingCallOverlay />
    </TelnyxProvider>
  );
}
