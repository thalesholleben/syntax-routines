import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Activity, FolderTree, KeyRound, Languages, LogOut } from "lucide-react";

import { LanguageSwitch } from "../components/LanguageSwitch";
import { MailSettingsCard } from "../components/MailSettingsCard";
import { PageHeader } from "../components/PageHeader";
import { Badge, Button, Card, ErrorBox, Input, Label, Select, Skeleton, Spinner } from "../components/ui";
import { useI18n } from "../i18n";
import { apiRequest, formatApiError } from "../lib/api";
import { useFormat } from "../lib/format";
import type { AgentKind, MailMeta, Platform, SettingsDto, SettingsResponse, StatusDto } from "../types";

const PARALLEL_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10];
const BOOT_DELAY_OPTIONS = [0, 5, 10, 15, 30, 60];
const EMPTY_PASSWORDS = { currentPassword: "", newPassword: "", confirmPassword: "" };

type FormState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; message: string } | { kind: "error"; message: string };

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const { m, language } = useI18n();
  const f = useFormat();
  const baseId = useId();
  const [form, setForm] = useState<SettingsDto | null>(null);
  const [mail, setMail] = useState<MailMeta | null>(null);
  const [platform, setPlatform] = useState<Platform>("other");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settingsState, setSettingsState] = useState<FormState>({ kind: "idle" });
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [passwords, setPasswords] = useState(EMPTY_PASSWORDS);
  const [passwordState, setPasswordState] = useState<FormState>({ kind: "idle" });

  const loadSettings = useCallback(() => {
    setLoadError(null);
    apiRequest<SettingsResponse>("/api/settings")
      .then((data) => {
        setForm(data.settings);
        setMail(data.mail);
        setPlatform(data.platform);
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

  // O motivo do selo vem traduzido pelo servidor: trocar o idioma do painel pede o estado do e-mail de novo.
  const shownLanguage = useRef(language);
  useEffect(() => {
    if (shownLanguage.current === language) return;
    shownLanguage.current = language;
    refreshMail();
  }, [language]);

  function updateForm(patch: Partial<SettingsDto>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
    setSettingsState({ kind: "idle" });
  }

  // O idioma sai do seletor (que ja gravou no servidor), nunca do formulario: salvar Ajustes nao o desfaz. O
  // destinatario tambem fica de fora: quem grava e o modal de e-mail.
  async function persistSettings(): Promise<boolean> {
    if (!form) return false;
    setSettingsState({ kind: "saving" });
    try {
      const body = {
        rootDirectory: form.rootDirectory,
        claudeBin: form.claudeBin,
        codexBin: form.codexBin,
        maxParallel: form.maxParallel,
        bootDelayMinutes: form.bootDelayMinutes,
        language
      };
      const data = await apiRequest<SettingsResponse>("/api/settings", { method: "PUT", body });
      setForm(data.settings);
      setMail(data.mail);
      setSettingsState({ kind: "saved", message: m.settingsSaved });
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

  // O modal grava conta e destinatario: o formulario de cima recebe so o destinatario novo, sem perder o que esta digitado.
  function applyMail(data: SettingsResponse) {
    setMail(data.mail);
    setForm((current) => (current ? { ...current, notifyEmail: data.settings.notifyEmail } : current));
  }

  function refreshMail() {
    apiRequest<SettingsResponse>("/api/settings")
      .then((data) => setMail(data.mail))
      .catch(() => undefined);
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordState({ kind: "error", message: m.confirmationMismatch });
      return;
    }
    setPasswordState({ kind: "saving" });
    try {
      await apiRequest("/api/settings/password", {
        method: "PUT",
        body: { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword }
      });
      setPasswords(EMPTY_PASSWORDS);
      setPasswordState({ kind: "saved", message: m.passwordChanged });
    } catch (error) {
      setPasswordState({ kind: "error", message: formatApiError(error) });
    }
  }

  const fieldId = (name: string) => `${baseId}-${name}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={m.navSettings} subtitle={m.settingsSubtitle} />
      <div className="flex-1 overflow-y-auto p-3 pb-24 md:pb-3">
        <div className="mx-auto max-w-2xl space-y-4">
          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <FolderTree aria-hidden className="size-4 text-[var(--color-primary)]" /> {m.rootAndAgents}
            </h2>

            {form === null ? (
              loadError ? (
                <div className="mt-3 space-y-2">
                  <ErrorBox>{loadError}</ErrorBox>
                  <Button size="sm" variant="outline" onClick={loadSettings}>
                    {m.retry}
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
                  <Label htmlFor={fieldId("root")}>{m.rootFolder}</Label>
                  <Input
                    id={fieldId("root")}
                    value={form.rootDirectory}
                    placeholder={m.rootPlaceholder}
                    onChange={(event) => updateForm({ rootDirectory: event.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{m.rootHint}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={fieldId("claude")}>{m.claudeBin}</Label>
                    <Input id={fieldId("claude")} value={form.claudeBin} onChange={(event) => updateForm({ claudeBin: event.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={fieldId("codex")}>{m.codexBin}</Label>
                    <Input id={fieldId("codex")} value={form.codexBin} onChange={(event) => updateForm({ codexBin: event.target.value })} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={fieldId("parallel")}>{m.maxParallel}</Label>
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
                    <Label htmlFor={fieldId("delay")}>{m.bootDelay}</Label>
                    <Select
                      id={fieldId("delay")}
                      value={String(form.bootDelayMinutes)}
                      onChange={(event) => updateForm({ bootDelayMinutes: Number(event.target.value) })}
                    >
                      {BOOT_DELAY_OPTIONS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes === 0 ? m.noDelay : m.minutes(minutes)}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{m.bootDelayHint}</p>
                  </div>
                </div>

                {settingsState.kind === "error" && <ErrorBox>{settingsState.message}</ErrorBox>}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  {settingsState.kind === "saved" && (
                    <span role="status" className="text-xs text-[var(--color-success)]">
                      {settingsState.message}
                    </span>
                  )}
                  <Button type="submit" disabled={settingsState.kind === "saving"}>
                    {settingsState.kind === "saving" && <Spinner className="size-4" />} {m.saveSettings}
                  </Button>
                </div>
              </form>
            )}
          </Card>

          <MailSettingsCard mail={mail} platform={platform} notifyEmail={form?.notifyEmail ?? ""} onSaved={applyMail} onRefresh={refreshMail} />

          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <Activity aria-hidden className="size-4 text-[var(--color-primary)]" /> {m.scheduler}
            </h2>
            {status ? (
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-[var(--color-fg-subtle)]">{m.lastCheck}</dt>
                  <dd className="mt-0.5 text-[var(--color-fg)]">{status.lastTickAt ? f.formatRelative(status.lastTickAt, status.now) : m.notRunYet}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-fg-subtle)]">{m.runningNow}</dt>
                  <dd className="tabular mt-0.5 text-[var(--color-fg)]">{status.runningCount}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-fg-subtle)]">{m.usageLimit}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {(["CLAUDE", "CODEX"] as AgentKind[]).map((kind) => {
                      const limit = status.limits[kind];
                      return (
                        <Badge key={kind} tone={limit.isOnLimit ? "warning" : "success"}>
                          {f.agentLabel[kind]}: {limit.isOnLimit ? m.until(limit.resetAt ? f.formatDateTime(Date.parse(limit.resetAt)) : m.noTime) : m.free}
                        </Badge>
                      );
                    })}
                  </dd>
                </div>
              </dl>
            ) : (
              <Skeleton className="mt-3 h-12" />
            )}
            <p className="mt-3 text-[11px] text-[var(--color-fg-subtle)]">{m.schedulerHint}</p>
          </Card>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
                <Languages aria-hidden className="size-4 text-[var(--color-primary)]" /> {m.language}
              </h2>
              <p className="text-xs text-[var(--color-fg-subtle)]">{m.languageHint}</p>
            </div>
            <LanguageSwitch isAuthenticated />
          </Card>

          <Card className="p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
              <KeyRound aria-hidden className="size-4 text-[var(--color-primary)]" /> {m.passwordSection}
            </h2>
            <form className="mt-3 space-y-3" onSubmit={changePassword}>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label htmlFor={fieldId("current")}>{m.currentPassword}</Label>
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
                  <Label htmlFor={fieldId("new")}>{m.newPassword}</Label>
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
                  <Label htmlFor={fieldId("confirm")}>{m.confirmNewPassword}</Label>
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
                  {m.changePassword}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-fg)]">{m.session}</h2>
              <p className="text-xs text-[var(--color-fg-subtle)]">{m.sessionHint}</p>
            </div>
            <Button variant="outline" onClick={onLogout}>
              <LogOut aria-hidden className="size-4" /> {m.logout}
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}
