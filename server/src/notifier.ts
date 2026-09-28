// Texto dos avisos por e-mail. Sem estado e sem envio: o agendador escolhe o que avisar, o mailer entrega.
// O HTML segue o aviso interno aprovado da SyntaxLab (mail-layout.ts); o texto puro vai junto no multipart.
import { DEFAULT_LANGUAGE, LOCALE, messages, type Language, type Messages } from "./i18n";
import { block, renderInternalMail } from "./mail-layout";
import type { RoutineRow, RunRow } from "./routines";

export const ERROR_IN_EMAIL_MAX_CHARS = 3000;

const KIND_LABEL: Record<string, string> = { CLAUDE: "Claude Code", CODEX: "Codex", SCRIPT: "Script" };

function formatDateTime(ms: number | null, language: Language): string {
  if (!ms) return messages(language).mailNoTime;
  return new Intl.DateTimeFormat(LOCALE[language], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
}

/** Assunto em uma linha: nome de rotina com quebra de linha nao abre cabecalho novo. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** O que muda por idioma no layout: selo, assinatura, rodape e o lang do HTML. */
function chrome(m: Messages, language: Language) {
  return { lang: LOCALE[language], badge: m.mailInternalBadge, tagline: m.mailTagline, footer: m.mailFooter };
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
  const exitCode = run.exitCode === null ? m.mailNoExitCode : String(run.exitCode);
  const rows: [string, string][] = [
    [m.mailRoutine, routine.name],
    [m.mailKind, kind],
    [m.mailScheduledFor, formatDateTime(run.scheduledFor, language)],
    [m.mailFinishedAt, formatDateTime(run.finishedAt, language)],
    [m.mailAttempt, String(run.attempt)],
    [m.mailExitCode, exitCode]
  ];
  const subject = m.mailFailedSubject(oneLine(routine.name));
  const text = [
    m.mailFailedIntro(routine.name),
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `${m.mailError}:`,
    error,
    "",
    `${m.mailPanel}: ${panelUrl}`
  ].join("\n");
  const html = renderInternalMail({
    ...chrome(m, language),
    subject,
    preheader: m.mailFailedPreheader(kind, String(run.attempt), exitCode),
    blocks: [
      block.status(m.mailFailedBadge, "error"),
      block.title(m.mailFailedTitle(routine.name)),
      block.fields(rows),
      block.code(m.mailError, error),
      block.button(m.mailOpenPanel, panelUrl)
    ]
  });
  return { subject, text, html };
}

export function buildTestEmail(panelUrl: string, language: Language = DEFAULT_LANGUAGE): { subject: string; text: string; html: string } {
  const m = messages(language);
  return {
    subject: m.mailTestSubject,
    text: `${m.mailTestLine1} ${m.mailTestLine2}\n\n${m.mailPanel}: ${panelUrl}`,
    html: renderInternalMail({
      ...chrome(m, language),
      subject: m.mailTestSubject,
      preheader: m.mailTestLine2,
      blocks: [
        block.status(m.mailTestBadge, "neutral"),
        block.title(m.mailTestTitle),
        block.paragraph(`${m.mailTestLine1} ${m.mailTestLine2}`),
        block.button(m.mailOpenPanel, panelUrl)
      ]
    })
  };
}
