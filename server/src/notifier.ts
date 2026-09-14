// Texto dos avisos por e-mail. Sem estado e sem envio: o agendador escolhe o que avisar, o mailer entrega.
import { DEFAULT_LANGUAGE, LOCALE, messages, type Language } from "./i18n";
import type { RoutineRow, RunRow } from "./routines";

export const ERROR_IN_EMAIL_MAX_CHARS = 3000;

const KIND_LABEL: Record<string, string> = { CLAUDE: "Claude Code", CODEX: "Codex", SCRIPT: "Script" };

function formatDateTime(ms: number | null, language: Language): string {
  if (!ms) return messages(language).mailNoTime;
  return new Intl.DateTimeFormat(LOCALE[language], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function shell(content: string, language: Language): string {
  return `<!doctype html>
<html lang="${LOCALE[language]}">
  <body style="margin:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;color:#f5f5f5;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#171717;border:1px solid #292929;border-radius:12px;padding:28px;">
        <p style="margin:0 0 18px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#a3a3a3;">Syntax Routines</p>
        <div style="font-size:15px;line-height:1.55;">${content}</div>
      </div>
    </div>
  </body>
</html>`;
}

function details(rows: [string, string][]): string {
  return `<div style="margin-top:18px;font-size:14px;">${rows
    .map(([label, value]) => `<p style="margin:6px 0;"><span style="color:#a3a3a3;">${escapeHtml(label)}:</span> <strong>${escapeHtml(value)}</strong></p>`)
    .join("")}</div>`;
}

export interface FailureEmailInput {
  run: RunRow;
  routine: RoutineRow;
  panelUrl: string;
  language?: Language;
}

export function buildFailureEmail({ run, routine, panelUrl, language = DEFAULT_LANGUAGE }: FailureEmailInput): { subject: string; text: string; html: string } {
  const m = messages(language);
  const kind = KIND_LABEL[run.agentKind ?? routine.agentKind] ?? routine.agentKind;
  const error = (run.error ?? m.mailNoDetail).trim().slice(0, ERROR_IN_EMAIL_MAX_CHARS);
  const rows: [string, string][] = [
    [m.mailRoutine, routine.name],
    [m.mailKind, kind],
    [m.mailScheduledFor, formatDateTime(run.scheduledFor, language)],
    [m.mailFinishedAt, formatDateTime(run.finishedAt, language)],
    [m.mailAttempt, String(run.attempt)],
    [m.mailExitCode, run.exitCode === null ? m.mailNoExitCode : String(run.exitCode)]
  ];
  const subject = m.mailFailedSubject(routine.name);
  const text = [
    m.mailFailedIntro(routine.name),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `${m.mailError}:`,
    error,
    "",
    `${m.mailPanel}: ${panelUrl}`
  ].join("\n");
  const html = shell(
    `
    <p>${m.mailFailedIntroHtml(escapeHtml(routine.name))}</p>
    ${details(rows)}
    <p style="margin:18px 0 6px;color:#a3a3a3;font-size:13px;">${m.mailError}</p>
    <pre style="margin:0;padding:12px;background:#0a0a0a;border:1px solid #292929;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word;color:#f5f5f5;">${escapeHtml(error)}</pre>
    <p style="margin:22px 0 0;"><a href="${escapeHtml(panelUrl)}" style="color:#1e9dc8;">${m.mailOpenPanel}</a></p>
  `,
    language
  );
  return { subject, text, html };
}

export function buildTestEmail(panelUrl: string, language: Language = DEFAULT_LANGUAGE): { subject: string; text: string; html: string } {
  const m = messages(language);
  return {
    subject: m.mailTestSubject,
    text: `${m.mailTestLine1} ${m.mailTestLine2}\n\n${m.mailPanel}: ${panelUrl}`,
    html: shell(
      `
      <p>${m.mailTestLine1}</p>
      <p>${m.mailTestLine2}</p>
      <p style="margin:22px 0 0;"><a href="${escapeHtml(panelUrl)}" style="color:#1e9dc8;">${m.mailOpenPanel}</a></p>
    `,
      language
    )
  };
}
