import { useId, useState, type FormEvent } from "react";
import { ExternalLink, Mail, PlugZap, Send, Settings2, Trash2 } from "lucide-react";

import { useI18n } from "../i18n";
import { apiRequest, formatApiError } from "../lib/api";
import { useFormat } from "../lib/format";
import type { MailMeta, SettingsResponse } from "../types";
import { Badge, Button, Card, ErrorBox, Input, Label, Modal, Select, Skeleton, Spinner } from "./ui";

const GMAIL = { host: "smtp.gmail.com", port: 587 };
const GMAIL_APP_PASSWORDS = "https://myaccount.google.com/apppasswords";

type Provider = "gmail" | "other";
type ActionState = { kind: "idle" } | { kind: "busy" } | { kind: "done"; message: string } | { kind: "error"; message: string };

/**
 * Bloco "Avisos por e-mail" de Ajustes: selo do ultimo envio ou teste, o modal da conta que envia e o e-mail de
 * teste. A senha so sai daqui digitada; o servidor guarda cifrada e nunca devolve.
 */
export function MailSettingsCard({
  mail,
  notifyEmail,
  onSaved,
  onRefresh
}: {
  mail: MailMeta | null;
  notifyEmail: string;
  onSaved: (data: SettingsResponse) => void;
  onRefresh: () => void;
}) {
  const { m } = useI18n();
  const f = useFormat();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [testState, setTestState] = useState<ActionState>({ kind: "idle" });

  // O teste passa pelo mesmo caminho do aviso de falha e atualiza o selo, por isso recarrega o estado no fim.
  async function sendTest() {
    setTestState({ kind: "busy" });
    try {
      const data = await apiRequest<{ sentTo: string }>("/api/settings/notify-test", { method: "POST" });
      setTestState({ kind: "done", message: m.testMailSent(data.sentTo) });
    } catch (error) {
      setTestState({ kind: "error", message: formatApiError(error) });
    }
    onRefresh();
  }

  const state = !mail?.isConfigured ? "off" : mail.status.state;
  const badge = {
    off: { tone: "muted", label: m.mailStatusOff },
    ok: { tone: "success", label: m.mailStatusOk },
    failed: { tone: "danger", label: m.mailStatusFailed },
    untested: { tone: "warning", label: m.mailStatusUntested }
  }[state];

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-fg)]">
        <Mail aria-hidden className="size-4 text-[var(--color-primary)]" /> {m.mailAlerts}
      </h2>

      {mail === null ? (
        <Skeleton className="mt-3 h-16" />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <span className="min-w-0 break-words text-xs text-[var(--color-fg-muted)]">
              {!mail.isConfigured ? m.mailOffHint : notifyEmail ? m.mailRoute(mail.fromEmail, notifyEmail) : m.mailNoRecipient(mail.fromEmail)}
            </span>
          </div>
          {mail.source === "env" && <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{m.mailFromEnv}</p>}
          {state === "failed" && testState.kind !== "error" && (
            <p className="mt-2 text-xs text-[var(--color-danger)]">
              {mail.status.message}
              {mail.status.detail && <span className="mt-0.5 block break-words text-[11px] text-[var(--color-fg-subtle)]">{mail.status.detail}</span>}
            </p>
          )}
          {mail.isConfigured && mail.status.at !== null && (
            <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{m.mailLastCheck(f.formatRelative(mail.status.at))}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant={mail.isConfigured ? "outline" : "primary"} onClick={() => setIsDialogOpen(true)}>
              <Settings2 aria-hidden className="size-4" /> {m.configureMail}
            </Button>
            {mail.isConfigured && (
              <Button variant="outline" onClick={() => void sendTest()} disabled={testState.kind === "busy" || !notifyEmail}>
                {testState.kind === "busy" ? <Spinner className="size-4" /> : <Send aria-hidden className="size-4" />} {m.sendTestMail}
              </Button>
            )}
          </div>
          {testState.kind === "error" && (
            <div className="mt-2">
              <ErrorBox>{testState.message}</ErrorBox>
            </div>
          )}
          {testState.kind === "done" && (
            <p role="status" className="mt-2 text-xs text-[var(--color-success)]">
              {testState.message}
            </p>
          )}

          {isDialogOpen && (
            <MailDialog
              mail={mail}
              notifyEmail={notifyEmail}
              onClose={() => setIsDialogOpen(false)}
              onSaved={(data) => {
                setTestState({ kind: "idle" });
                onSaved(data);
              }}
            />
          )}
        </>
      )}
    </Card>
  );
}

function MailDialog({
  mail,
  notifyEmail: savedNotifyEmail,
  onClose,
  onSaved
}: {
  mail: MailMeta;
  notifyEmail: string;
  onClose: () => void;
  onSaved: (data: SettingsResponse) => void;
}) {
  const { m } = useI18n();
  const baseId = useId();
  const formId = `${baseId}-form`;
  const hasAccount = mail.source !== null;
  const [provider, setProvider] = useState<Provider>(!hasAccount || (mail.host === GMAIL.host && mail.port === GMAIL.port) ? "gmail" : "other");
  const [host, setHost] = useState(hasAccount ? mail.host : "");
  const [port, setPort] = useState(hasAccount ? String(mail.port) : "587");
  const [fromEmail, setFromEmail] = useState(mail.fromEmail);
  const [password, setPassword] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(savedNotifyEmail);
  // Conta vinda do .env fica resumida: salvar sem abrir grava so o destinatario.
  const [isEditingAccount, setIsEditingAccount] = useState(mail.source !== "env");
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const isBusy = state.kind === "busy";
  const isGmail = provider === "gmail";
  const canKeepPassword = mail.source === "panel";

  // O destinatario acompanha o remetente enquanto a pessoa nao escolheu outro.
  function changeFromEmail(next: string) {
    setNotifyEmail((current) => (current === "" || current === fromEmail ? next : current));
    setFromEmail(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState({ kind: "busy" });
    const account = isEditingAccount
      ? { host: isGmail ? GMAIL.host : host.trim(), port: isGmail ? GMAIL.port : Number(port), fromEmail: fromEmail.trim(), password }
      : null;
    try {
      const data = await apiRequest<SettingsResponse>("/api/settings/mail", { method: "PUT", body: { account, notifyEmail: notifyEmail.trim() } });
      setState({ kind: "idle" });
      onSaved(data);
      onClose();
    } catch (error) {
      setState({ kind: "error", message: formatApiError(error) });
    }
  }

  async function removeAccount() {
    if (!window.confirm(m.mailRemoveConfirm)) return;
    setState({ kind: "busy" });
    try {
      const data = await apiRequest<SettingsResponse>("/api/settings/mail", { method: "DELETE" });
      setState({ kind: "idle" });
      onSaved(data);
      onClose();
    } catch (error) {
      setState({ kind: "error", message: formatApiError(error) });
    }
  }

  const fieldId = (name: string) => `${baseId}-${name}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={m.mailDialogTitle}
      busy={isBusy}
      footer={
        <div className="space-y-2">
          {state.kind === "error" && <ErrorBox>{state.message}</ErrorBox>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {canKeepPassword ? (
              <Button variant="ghost" size="sm" onClick={() => void removeAccount()} disabled={isBusy} className="text-[var(--color-danger)] hover:text-[var(--color-danger)]">
                <Trash2 aria-hidden className="size-4" /> {m.mailRemove}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={onClose} disabled={isBusy}>
                {m.cancel}
              </Button>
              <Button type="submit" form={formId} disabled={isBusy}>
                {isBusy ? <Spinner /> : <PlugZap aria-hidden className="size-4" />}{" "}
                {isBusy ? (isEditingAccount ? m.mailTesting : m.saving) : isEditingAccount ? m.mailSaveAndTest : m.mailSaveRecipient}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)}>
        <fieldset disabled={isBusy} className="min-w-0 space-y-4">
          <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">{m.mailDialogIntro}</p>

          {isEditingAccount ? (
            <>
              <div>
                <Label htmlFor={fieldId("provider")}>{m.mailProvider}</Label>
                <Select id={fieldId("provider")} value={provider} onChange={(event) => setProvider(event.target.value === "other" ? "other" : "gmail")}>
                  <option value="gmail">{m.mailProviderGmail}</option>
                  <option value="other">{m.mailProviderOther}</option>
                </Select>
              </div>

              {!isGmail && (
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                  <div>
                    <Label htmlFor={fieldId("host")}>{m.mailHost}</Label>
                    <Input
                      id={fieldId("host")}
                      value={host}
                      required
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={m.mailHostPlaceholder}
                      onChange={(event) => setHost(event.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor={fieldId("port")}>{m.mailPort}</Label>
                    <Input
                      id={fieldId("port")}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      required
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-[var(--color-fg-subtle)] sm:col-span-2">{m.mailPortHint}</p>
                </div>
              )}

              <div>
                <Label htmlFor={fieldId("from")}>{m.mailFromLabel}</Label>
                <Input
                  id={fieldId("from")}
                  type="email"
                  autoComplete="email"
                  required
                  value={fromEmail}
                  placeholder={m.mailFromPlaceholder}
                  onChange={(event) => changeFromEmail(event.target.value)}
                />
              </div>

              <div>
                <Label htmlFor={fieldId("password")}>{isGmail ? m.mailPasswordGmail : m.mailPassword}</Label>
                <Input
                  id={fieldId("password")}
                  type="password"
                  autoComplete="new-password"
                  required={!canKeepPassword}
                  value={password}
                  placeholder={canKeepPassword ? m.mailPasswordKeep : undefined}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {isGmail && (
                  <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">
                    {m.mailGmailHint}{" "}
                    <a
                      href={GMAIL_APP_PASSWORDS}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[var(--color-primary)] hover:underline"
                    >
                      {m.mailGmailLink} <ExternalLink aria-hidden className="size-3" />
                    </a>
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs text-[var(--color-fg-muted)]">
              <p className="break-words">{m.mailEnvAccount(mail.fromEmail, `${mail.host}:${mail.port}`)}</p>
              <Button size="sm" variant="ghost" className="mt-2 px-0 text-[var(--color-primary)]" onClick={() => setIsEditingAccount(true)}>
                {m.mailUseOtherAccount}
              </Button>
            </div>
          )}

          <div>
            <Label htmlFor={fieldId("to")}>{m.mailTo}</Label>
            <Input
              id={fieldId("to")}
              type="email"
              autoComplete="email"
              required
              value={notifyEmail}
              placeholder={m.notifyPlaceholder}
              onChange={(event) => setNotifyEmail(event.target.value)}
            />
            <p className="mt-1 text-[11px] text-[var(--color-fg-subtle)]">{m.mailToHint}</p>
          </div>

          {isEditingAccount && <p className="text-[11px] leading-relaxed text-[var(--color-fg-subtle)]">{m.mailSecretHint}</p>}
        </fieldset>
      </form>
    </Modal>
  );
}
