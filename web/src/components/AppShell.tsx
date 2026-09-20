import { Button, Call, History, List, Logout, Settings, ThemeToggle, cn } from "@virtual-phone/ui";
import type { SessionDto } from "@virtual-phone/shared";
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/phone", label: "Softphone", icon: Call },
  { to: "/history", label: "History", icon: History },
  { to: "/logs", label: "Logs", icon: List },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppShell({
  session,
  onLogout,
  children,
}: {
  session: SessionDto;
  onLogout: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:px-6">
        <div className="flex items-center gap-2.5 md:gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Call size={16} />
          </span>
          <span className="font-semibold">Virtual Phone</span>
          <span className="hidden rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground sm:inline">
            softphone
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground md:gap-3">
          <span className="hidden font-mono md:inline">session {session.id.slice(0, 8)}</span>
          <ThemeToggle
            className="rounded-full p-1.5 hover:bg-secondary hover:text-foreground"
            iconClassName="h-4 w-4"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Sign out"
            className="h-9 w-9 md:hidden"
            onClick={onLogout}
          >
            <Logout size={16} />
          </Button>
          <Button size="sm" variant="ghost" className="hidden px-0 md:inline-flex" onClick={onLogout}>
            <Logout size={14} /> Sign out
          </Button>
        </div>
      </header>

      <nav className="hidden gap-1 border-b border-border px-6 py-2 md:flex">
        {LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <Icon size={15} />
              {link.label}
            </NavLink>
          );
        })}
      </nav>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-8 md:pt-8">
        {children}
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={20} className={cn(isActive && "text-primary")} />
                  {link.label}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
