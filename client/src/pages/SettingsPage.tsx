import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Activity, FolderTree, KeyRound, LogOut, Mail, Send } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Card, ErrorBox, Input, Label, Select, Skeleton, Spinner } from "../components/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { AGENT_LABEL, formatDateTime, formatRelative } from "../lib/format";
import type { AgentKind, MailMeta, SettingsDto, SettingsResponse, StatusDto } from "../types";

const PARALLEL_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];
const BOOT_DELAY_OPTIONS = [0, 5, 10, 15, 30, 60];
const EMPTY_PASSWORDS = { currentPassword: "", newPassword: "", confirmPassword: "" };

type FormState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; message: string } | { kind: "error"; message: string };

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const baseId = useId();
  const [form, setForm] = useState<SettingsDto | null>(null);
  const [mail, setMail] = useState<MailMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsState, setSettingsState] = useState<FormState>({ kind: "idle" });
  const [mailTestState, setMailTestState] = useState<FormState>({ kind: "idle" });
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const [passwordState, setPasswordState] = useState<FormState>({ kind: "idle" });

  const loadSettings = useCallback(() => {
    setLoadError(null);
    apiRequest<SettingsResponse>("/api/settings")
      .then((data) => {
        setForm(data.settings);
        setMail(data.mail);
      })
      .catch((error: unknown) => setLoadError(formatApiError(error)));
  }, []);

  useEffect(() => {
    loadSettings();
    const loadStatus = () => {
      apiRequest<StatusDto>("/api/status")
        .then(setStatus)
        .catch(() => undefined);
    };
    loadStatus();
    const timer = setInterval(loadStatus, 10_000);
    return () => clearInterval(timer);
  }, [loadSettings]);

  function updateForm(patch: Partial<SettingsDto>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setSettingsState({ kind: "idle" });
  }

  async function persistSettings(): Promise<boolean> {
    if (!form) return false;
    setSettingsState({ kind: "saving" });
    try {
      const data = await apiRequest<SettingsResponse>("/api/settings", { method: "PUT", body: form });
      setForm(data.settings);
      setMail(data.mail);
      setSettingsState({ kind: "saved", message: "Ajustes salvos." });
      return true;
    } catch (error) {
      setSettingsState({ kind: "error", message: formatApiError(error) });
      return false;
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    await persistSettings();
  }

  // Salva primeiro: o teste usa o destinatario gravado, o mesmo caminho do aviso de falha.
  async function sendTestMail() {
    setMailTestState({ kind: "saving" });
    if (!(await persistSettings())) {
      setMailTestState({ kind: "idle" });
      return;
    }
    try {
      const data = await apiRequest<{ sentTo: string }>("/api/settings/notify-test", { method: "POST" });
      setMailTestState({ kind: "saved", message: `E-mail de teste enviado para ${data.sentTo}.` });
    } catch (error) {
      setMailTestState({ kind: "error", message: formatApiError(error) });
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordState({ kind: "error", message: "A confirmação não confere com a nova senha." });
      return;
    }
    setPasswordState({ kind: "saving" });
    try {
      await apiRequest("/api/settings/password", {
        method: "PUT",
        body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword }
      });
      setPasswords(EMPTY_PASSWORDS);
      setPasswordState({ kind: "saved", message: "Senha trocada. As outras sessões foram encerradas." });
    } catch (error) {
      setPasswordState({ kind: "error", message: formatApiError(error) });
    }
  }

  const fieldId = (name: string) => `${baseId}-${name}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Ajustes" subtitle="Configuração deste PC" />
      <div className="flex-1 overflow-y-auto p-3 pb-24 md:pb-3">
        <div className="mx-auto max-w-2xl space-y-4">
          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <FolderTree aria-hidden className="size-4 text-[var(--color-primary)]" /> Pasta mãe e agentes
            </h2>

            {form === null ? (
              loadError ? (
                <div className="mt-3 space-y-2">
                  <ErrorBox>{loadError}</ErrorBox>
                  <Button size="sm" variant="outline" onClick={loadSettings}>
                    Tentar de novo
                  </Button>
                </div>
              ) : (
                <div aria-busy="true" className="mt-3 space-y-3">
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                  <Skeleton className="h-9" />
                </div>
              )
            ) : (
              <form className="mt-3 space-y-3" onSubmit={saveSettings}>
                <div>
                  <Label htmlFor={fieldId("root")}>Pasta mãe</Label>
                  <Input
                    id={fieldId("root")}
                    value={form.rootDirectory}
                    placeholder="C:\Users\voce\Projetos"
                    onChange={(event) => updateForm({ rootDirectory: event.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                    Os agentes só rodam dentro desta pasta ou das subpastas dela. Rotina fora dela falha sem executar.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={fieldId("claude")}>Binário do Claude Code</Label>
                    <Input id={fieldId("claude")} value={form.claudeBin} onChange={(event) => updateForm({ claudeBin: event.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={fieldId("codex")}>Binário do Codex</Label>
                    <Input id={fieldId("codex")} value={form.codexBin} onChange={(event) => updateForm({ codexBin: event.target.value })} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={fieldId("parallel")}>Execuções ao mesmo tempo</Label>
                    <Select
                      id={fieldId("parallel")}
                      value={String(form.maxParallel)}
                      onChange={(event) => updateForm({ maxParallel: Number(event.target.value) })}
                    >
                      {PARALLEL_OPTIONS.map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={fieldId("delay")}>Atraso ao ligar o PC</Label>
                    <Select
                      id={fieldId("delay")}
                      value={String(form.bootDelayMinutes)}
                      onChange={(event) => updateForm({ bootDelayMinutes: Number(event.target.value) })}
                    >
                      {BOOT_DELAY_OPTIONS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes === 0 ? "sem atraso" : `${minutes} min`}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">Vale para as rotinas marcadas para executar ao ligar.</p>
                  </div>
                </div>

                <div className="border-t border-[var(--color-border)] pt-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                    <Mail aria-hidden className="size-4 text-[var(--color-primary)]" /> Avisos por e-mail
                  </h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div>
                      <Label htmlFor={fieldId("notify")}>E-mail de aviso</Label>
                      <Input
                        id={fieldId("notify")}
                        type="email"
                        autoComplete="email"
                        placeholder="voce@exemplo.com"
                        value={form.notifyEmail}
                        onChange={(event) => updateForm({ notifyEmail: event.target.value })}
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={() => void sendTestMail()} disabled={mailTestState.kind === "saving" || !form.notifyEmail.trim()}>
                      {mailTestState.kind === "saving" ? <Spinner className="size-4" /> : <Send aria-hidden className="size-4" />} Enviar e-mail de teste
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">
                    Quando uma rotina falhar, o aviso chega aqui. Vazio, ninguém é avisado.{" "}
                    {mail?.isConfigured
                      ? `Remetente: ${mail.from}.`
                      : "SMTP não configurado neste PC: crie o arquivo .env a partir do .env.example e reinicie o app."}
                  </p>
                  {mailTestState.kind === "error" && (
                    <div className="mt-2">
                      <ErrorBox>{mailTestState.message}</ErrorBox>
                    </div>
                  )}
                  {mailTestState.kind === "saved" && (
                    <p role="status" className="mt-2 text-xs text-[var(--color-success)]">
                      {mailTestState.message}
                    </p>
                  )}
                </div>

                {settingsState.kind === "error" && <ErrorBox>{settingsState.message}</ErrorBox>}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {settingsState.kind === "saved" && (
                    <span role="status" className="text-xs text-[var(--color-success)]">
                      {settingsState.message}
                    </span>
                  )}
                  <Button type="submit" disabled={settingsState.kind === "saving"}>
                    {settingsState.kind === "saving" && <Spinner className="size-4" />} Salvar ajustes
                  </Button>
                </div>
              </form>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <Activity aria-hidden className="size-4 text-[var(--color-primary)]" /> Agendador
            </h2>
            {status ? (
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--color-fg-subtle)]">Última verificação</dt>
                  <dd className="mt-0.5 text-[var(--color-fg)]">
                    {status.lastTickAt ? formatRelative(status.lastTickAt, status.now) : "ainda não rodou"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--color-fg-subtle)]">Executando agora</dt>
                  <dd className="tabular mt-0.5 text-[var(--color-fg)]">{status.runningCount}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-fg-subtle)]">Limite de uso</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {(["CLAUDE", "CODEX"] as AgentKind[]).map((kind) => {
                      const limit = status.limits[kind];
                      return (
                        <Badge key={kind} tone={limit.isOnLimit ? "warning" : "success"}>
                          {AGENT_LABEL[kind]}:{" "}
                          {limit.isOnLimit ? `até ${limit.resetAt ? formatDateTime(Date.parse(limit.resetAt)) : "sem horário"}` : "livre"}
                        </Badge>
                      );
                    })}
                  </dd>
                </div>
              </dl>
            ) : (
              <Skeleton className="mt-3 h-12" />
            )}
            <p className="mt-3 text-[11px] text-[var(--color-fg-subtle)]">
              O agendador confere as rotinas a cada 30 segundos enquanto o PC está ligado e o app está rodando.
            </p>
          </Card>

          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <KeyRound aria-hidden className="size-4 text-[var(--color-primary)]" /> Senha
            </h2>
            <form className="mt-3 space-y-3" onSubmit={changePassword}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor={fieldId("current")}>Senha atual</Label>
                  <Input
                    id={fieldId("current")}
                    type="password"
                    autoComplete="current-password"
                    required
                    value={passwords.currentPassword}
                    onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={fieldId("new")}>Nova senha</Label>
                  <Input
                    id={fieldId("new")}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={passwords.newPassword}
                    onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor={fieldId("confirm")}>Confirmar nova senha</Label>
                  <Input
                    id={fieldId("confirm")}
                    type="password"
                    autoComplete="new-password"
                    required
                    value={passwords.confirmPassword}
                    onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })}
                  />
                </div>
              </div>
              {passwordState.kind === "error" && <ErrorBox>{passwordState.message}</ErrorBox>}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {passwordState.kind === "saved" && (
                  <span role="status" className="text-xs text-[var(--color-success)]">
                    {passwordState.message}
                  </span>
                )}
                <Button type="submit" variant="outline" disabled={passwordState.kind === "saving"}>
                  Trocar senha
                </Button>
              </div>
            </form>
          </Card>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-fg)]">Sessão</h2>
              <p className="text-xs text-[var(--color-fg-subtle)]">Sai só deste navegador. As rotinas continuam rodando.</p>
            </div>
            <Button variant="outline" onClick={onLogout}>
              <LogOut aria-hidden className="size-4" /> Sair
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
