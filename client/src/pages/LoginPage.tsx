import { useId, useState, type FormEvent } from "react";
import { CalendarClock, Power, ScrollText } from "lucide-react";

import { Wordmark } from "../components/Logo";
import { Button, Input, Label, Spinner } from "../components/ui";
import { ApiError, apiRequest, formatApiError } from "../lib/api";

const FEATURES = [
  { label: "Rotinas por dia e hora", icon: CalendarClock },
  { label: "PC desligado sob controle", icon: Power },
  { label: "Histórico e saída de cada execução", icon: ScrollText }
];

export function LoginPage({
  isSetupRequired,
  onAuthenticated,
  onStateChanged
}: {
  isSetupRequired: boolean;
  onAuthenticated: () => void;
  onStateChanged: () => void;
}) {
  const baseId = useId();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (isBusy) return;
    setError(null);
    if (isSetupRequired && password !== confirmation) {
      setError("As senhas não conferem.");
      return;
    }
    setIsBusy(true);
    try {
      await apiRequest(isSetupRequired ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: { password } });
      onAuthenticated();
    } catch (err) {
      setError(formatApiError(err));
      // Outra aba criou a senha antes: recarrega o estado para mostrar o login.
      if (err instanceof ApiError && err.status === 409) onStateChanged();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[var(--color-bg)]">
      {/* Fundo atmosferico com o X da marca, bem apagado. O cartao e opaco, entao o veu so protege a copy. */}
      <div aria-hidden className="syntax-login-bg">
        <picture>
          <source media="(min-width: 1024px)" srcSet="/brand/login-bg-desktop.webp" />
          <img src="/brand/login-bg-mobile.webp" alt="" decoding="async" />
        </picture>
      </div>

      <main className="relative mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-6 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <div className="grid w-full gap-6 lg:grid-cols-2 lg:items-center lg:gap-12">
          <section className="max-w-xl space-y-6">
            <Wordmark />

            <div className="space-y-4">
              <h1 className="text-2xl font-bold leading-[1.04] tracking-tight text-[var(--color-fg)] sm:text-5xl lg:text-6xl">
                Suas rotinas rodam sozinhas.
                <br />
                <span className="text-gradient">No horário certo, neste PC.</span>
              </h1>
              <p className="max-w-lg text-sm leading-6 text-[var(--color-fg-muted)] sm:text-base">
                Cadastre uma vez: agente, dias, hora e prompt. O app executa o Claude Code ou o Codex no seu computador, respeita o
                limite de uso e decide o que fazer quando o PC estava desligado no horário.
              </p>
            </div>

            <div className="hidden grid-cols-3 gap-3 lg:grid">
              {FEATURES.map(({ label, icon: Icon }) => (
                <div
                  key={label}
                  className="card-hover glass flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-4 text-center"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <span className="text-xs leading-tight text-[var(--color-fg-muted)]">{label}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="flex w-full max-w-md flex-col items-stretch gap-3 lg:ml-auto">
            <div className="flex justify-start lg:justify-end">
              <div className="flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-1 backdrop-blur">
                <span className="rounded-full bg-[var(--color-primary)] px-3.5 py-1 text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-primary-fg)]">
                  {isSetupRequired ? "Primeiro acesso" : "Login"}
                </span>
              </div>
            </div>

            <div className="glass w-full rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] p-5 md:p-6">
              <div className="mb-5 space-y-1">
                <h2 className="text-xl font-semibold tracking-tight text-[var(--color-fg)]">{isSetupRequired ? "Criar senha" : "Entrar"}</h2>
                <p className="text-xs text-[var(--color-fg-subtle)]">
                  {isSetupRequired ? "Crie a senha que protege o painel deste PC." : "Use a senha deste PC."}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <Label htmlFor={`${baseId}-password`}>Senha</Label>
                  <Input
                    id={`${baseId}-password`}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isSetupRequired ? "new-password" : "current-password"}
                    placeholder="••••••••"
                    autoFocus
                    required
                  />
                </div>

                {isSetupRequired && (
                  <div>
                    <Label htmlFor={`${baseId}-confirmation`}>Confirmar senha</Label>
                    <Input
                      id={`${baseId}-confirmation`}
                      type="password"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      required
                    />
                  </div>
                )}

                {error && (
                  <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--color-danger)]/10 px-3 py-2 text-xs leading-5 text-[var(--color-danger)]">
                    {error}
                  </p>
                )}

                <Button type="submit" disabled={isBusy} className="w-full">
                  {isBusy ? <Spinner /> : isSetupRequired ? "Criar senha e entrar" : "Entrar"}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
