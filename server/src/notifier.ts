// Texto dos avisos por e-mail. Sem estado e sem envio: o agendador escolhe o que avisar, o mailer entrega.
import type { RoutineRow, RunRow } from "./routines";

export const ERROR_IN_EMAIL_MAX_CHARS = 3000;

const KIND_LABEL: Record<string, string> = { CLAUDE: "Claude Code", CODEX: "Codex", SCRIPT: "Script" };

const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function formatDateTime(ms: number | null): string {
  return ms ? dateTime.format(ms) : "sem horário";
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function shell(content: string): string {
  return `<!doctype html>
<html lang="pt-BR">
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
}

export function buildFailureEmail({ run, routine, panelUrl }: FailureEmailInput): { subject: string; text: string; html: string } {
  const kind = KIND_LABEL[run.agentKind ?? routine.agentKind] ?? routine.agentKind;
  const error = (run.error ?? "Sem detalhe registrado.").trim().slice(0, ERROR_IN_EMAIL_MAX_CHARS);
  const rows: [string, string][] = [
    ["Rotina", routine.name],
    ["Tipo", kind],
    ["Horário previsto", formatDateTime(run.scheduledFor)],
    ["Terminou em", formatDateTime(run.finishedAt)],
    ["Tentativa", String(run.attempt)],
    ["Código de saída", run.exitCode === null ? "nenhum" : String(run.exitCode)]
  ];
  const subject = `[Syntax Routines] Falhou: ${routine.name}`;
  const text = [
    `A rotina "${routine.name}" falhou.`,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Erro:",
    error,
    "",
    `Painel: ${panelUrl}`
  ].join("\n");
  const html = shell(`
    <p>A rotina <strong>${escapeHtml(routine.name)}</strong> falhou.</p>
    ${details(rows)}
    <p style="margin:18px 0 6px;color:#a3a3a3;font-size:13px;">Erro</p>
    <pre style="margin:0;padding:12px;background:#0a0a0a;border:1px solid #292929;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-word;color:#f5f5f5;">${escapeHtml(error)}</pre>
    <p style="margin:22px 0 0;"><a href="${escapeHtml(panelUrl)}" style="color:#1e9dc8;">Abrir o painel</a></p>
  `);
  return { subject, text, html };
}

export function buildTestEmail(panelUrl: string): { subject: string; text: string; html: string } {
  return {
    subject: "[Syntax Routines] E-mail de teste",
    text: `Este é o e-mail de teste do Syntax Routines. Quando uma rotina falhar, o aviso chega neste endereço.\n\nPainel: ${panelUrl}`,
    html: shell(`
      <p>Este é o e-mail de teste do Syntax Routines.</p>
      <p>Quando uma rotina falhar, o aviso chega neste endereço.</p>
      <p style="margin:22px 0 0;"><a href="${escapeHtml(panelUrl)}" style="color:#1e9dc8;">Abrir o painel</a></p>
    `)
  };
}
