import { useCallback, useEffect, useState } from "react";
import { CalendarClock, LogOut, Settings as SettingsIcon } from "lucide-react";

import { LanguageSwitch } from "./components/LanguageSwitch";
import { Logo } from "./components/Logo";
import { Button, ErrorBox, Spinner } from "./components/ui";
import { getLanguage, useI18n } from "./i18n";
import { apiRequest, formatApiError, setUnauthorizedHandler } from "./lib/api";
import { cn } from "./lib/cn";
import { LoginPage } from "./pages/LoginPage";
import { RoutinesPage } from "./pages/RoutinesPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { AuthState } from "./types";

type Tab = "routines" | "settings";

const NAV: { id: Tab; icon: typeof CalendarClock }[] = [
  { id: "routines", icon: CalendarClock },
  { id: "settings", icon: SettingsIcon }
];

export function App() {
  const { m } = useI18n();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("routines");

  const refreshAuth = useCallback(() => {
    setAuthError(null);
    apiRequest<AuthState>("/api/auth/state")
      .then(setAuth)
      .catch((error: unknown) => setAuthError(formatApiError(error)));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth({ isSetupRequired: false, isAuthenticated: false }));
    refreshAuth();
  }, [refreshAuth]);

  // Ao entrar, o idioma escolhido no navegador vai para Ajustes: e o que as notas e o e-mail vao usar.
  function handleAuthenticated() {
    setAuth({ isSetupRequired: false, isAuthenticated: true });
    apiRequest("/api/settings/language", { method: "PUT", body: { language: getLanguage() } }).catch(() => undefined);
  }

  async function logout() {
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setAuth({ isSetupRequired: false, isAuthenticated: false });
    setTab("routines");
  }

  if (auth === null) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[var(--color-bg)] p-4">
        {authError ? (
          <div className="w-full max-w-sm space-y-3 text-center">
            <Logo className="mx-auto size-12" />
            <ErrorBox>
              {m.cannotReach} {authError}
            </ErrorBox>
            <Button variant="outline" onClick={refreshAuth}>
              {m.retry}
            </Button>
          </div>
        ) : (
          <div aria-busy="true" className="flex flex-col items-center gap-3">
            <Logo className="size-12 opacity-90" />
            <Spinner />
          </div>
        )}
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <LoginPage
        isSetupRequired={auth.isSetupRequired}
        onAuthenticated={handleAuthenticated}
        onStateChanged={refreshAuth}
      />
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col-reverse bg-[var(--color-bg)] md:flex-row">
      {/* Rail lateral no desktop, tab bar inferior no celular: mesma casca do Syntax Ops. */}
      <nav
        aria-label={m.navLabel}
        className={cn(
          "z-30 flex shrink-0 items-stretch justify-around border-[var(--color-border)] bg-[var(--color-surface)]",
          "border-t pb-[env(safe-area-inset-bottom)]",
          "md:w-[68px] md:flex-col md:items-center md:justify-start md:gap-1 md:border-r md:border-t-0 md:pb-0 md:pt-4"
        )}
      >
        <div className="hidden md:mb-3 md:block">
          <Logo className="size-8" />
        </div>
        {NAV.map((item) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors md:w-full md:flex-none md:py-2",
                isActive ? "text-[var(--color-primary)]" : "text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-muted)]"
              )}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-[var(--radius-md)] transition-colors",
                  isActive && "bg-[var(--color-primary)]/15"
                )}
              >
                <Icon aria-hidden className="size-5" />
              </span>
              {item.id === "routines" ? m.navRoutines : m.navSettings}
            </button>
          );
        })}
        {/* Seletor de idioma discreto no pe do rail; no celular ele fica em Ajustes. */}
        <div className="hidden md:mt-auto md:flex md:justify-center">
          <LanguageSwitch isAuthenticated orientation="vertical" />
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          title={m.logout}
          aria-label={m.logout}
          className="hidden cursor-pointer md:mb-3 md:mt-2 md:flex md:size-9 md:items-center md:justify-center md:rounded-[var(--radius-md)] md:text-[var(--color-fg-subtle)] md:hover:bg-[var(--color-surface-2)] md:hover:text-[var(--color-danger)]"
        >
          <LogOut aria-hidden className="size-5" />
        </button>
      </nav>

      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {tab === "routines" ? <RoutinesPage onOpenSettings={() => setTab("settings")} /> : <SettingsPage onLogout={() => void logout()} />}
      </main>
    </div>
  );
}
