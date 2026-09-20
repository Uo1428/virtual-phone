import { Button, Call, Input, Key, ThemeToggle } from "@virtual-phone/ui";
import { type FormEvent, useState } from "react";

export function LoginPage({ onLogin }: { onLogin: (passcode?: string) => Promise<void> }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onLogin(passcode || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle
          className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          iconClassName="h-4 w-4"
        />
      </div>

      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Call size={22} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-card-foreground">Virtual Phone</h1>
            <p className="text-xs text-muted-foreground">Browser softphone on Telnyx</p>
          </div>
        </div>

        <Input
          label="Passcode"
          type="password"
          value={passcode}
          onChange={setPasscode}
          placeholder="Only if configured"
          autoComplete="current-password"
          leftIcon={<Key size={16} />}
        />

        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Signing in…" : "Continue"}
        </Button>

        <p className="text-center text-[11px] text-muted-foreground">
          No account needed — the server signs in with its Telnyx API key.
        </p>
      </form>
    </main>
  );
}
