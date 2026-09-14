import nodemailer from "nodemailer";
import { describe, expect, it } from "vitest";

import { createMailer, MailError, readSmtpConfig, sanitizeSmtpError, type MailTransport } from "./mailer";
import { buildFailureEmail, buildTestEmail } from "./notifier";
import type { RoutineRow, RunRow } from "./routines";

const env = {
  SMTP_USER: "avisos@example.com",
  SMTP_PASS: "senha-de-app",
  MAIL_FROM_EMAIL: "avisos@example.com",
  MAIL_FROM_NAME: "Syntax Routines Teste"
};

describe("readSmtpConfig", () => {
  it("padroes do gmail, 587 com STARTTLS, 465 e segura", () => {
    expect(readSmtpConfig({})).toMatchObject({ host: "smtp.gmail.com", port: 587, isSecure: false, fromName: "Syntax Routines" });
    expect(readSmtpConfig({ SMTP_PORT: "465" })).toMatchObject({ port: 465, isSecure: true });
    expect(readSmtpConfig({ SMTP_PORT: "465", SMTP_SECURE: "false" })).toMatchObject({ isSecure: false });
  });
});

describe("createMailer", () => {
  it("sem remetente, usuario ou senha fica desconfigurado e recusa antes de conectar", async () => {
    const mailer = createMailer({ SMTP_USER: "x", SMTP_PASS: "y" });
    expect(mailer.isConfigured).toBe(false);
    await expect(mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "<p>t</p>" })).rejects.toBeInstanceOf(MailError);
  });

  it("monta a mensagem com remetente nomeado e passa pelo transporte real do nodemailer (jsonTransport)", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sent: unknown[] = [];
    const spy: MailTransport = {
      sendMail: async (mail) => {
        const info = await transport.sendMail(mail);
        sent.push(JSON.parse(info.message as string));
        return info;
      }
    };
    const mailer = createMailer(env, spy);
    expect(mailer).toMatchObject({ isConfigured: true, from: "avisos@example.com" });
    await mailer.send({ to: "dono@example.com", subject: "Teste", text: "corpo", html: "<p>corpo</p>" });
    expect(sent[0]).toMatchObject({
      from: { address: "avisos@example.com", name: "Syntax Routines Teste" },
      to: [{ address: "dono@example.com" }],
      subject: "Teste",
      text: "corpo",
      html: "<p>corpo</p>"
    });
  });

  it("erro do SMTP vira MailError sem credencial", async () => {
    const failing: MailTransport = {
      sendMail: async () => {
        throw new Error("Invalid login: 535 AUTH PLAIN dXNlcjpzZW5oYQ== pass=senha-de-app");
      }
    };
    const mailer = createMailer(env, failing);
    const error = await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "t" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MailError);
    expect((error as Error).message).toBe("SMTP recusou o envio: Invalid login: 535 AUTH [redacted]");
    expect(sanitizeSmtpError(new Error("connect failed password=abc token=xyz"))).toBe("connect failed password=[redacted] token=[redacted]");
  });

  it("a senha e o usuario do .env somem do detalhe em qualquer formato que o SMTP os ecoe", async () => {
    const failing: MailTransport = {
      sendMail: async () => {
        throw new Error(`SMTP rejected password: ${env.SMTP_PASS} for ${env.SMTP_USER} (retry with ${env.SMTP_PASS})`);
      }
    };
    const mailer = createMailer(env, failing);
    const error = (await mailer.send({ to: "a@example.com", subject: "s", text: "t", html: "t" }).catch((err: unknown) => err)) as MailError;
    expect(error).toBeInstanceOf(MailError);
    expect(error.detail).toBe("SMTP rejected password: [redacted] for [redacted] (retry with [redacted])");
    expect(error.message).not.toContain(env.SMTP_PASS as string);
    expect(error.localized("en")).toBe("SMTP rejected the message: SMTP rejected password: [redacted] for [redacted] (retry with [redacted])");
    expect(error.localized("pt")).not.toContain(env.SMTP_PASS as string);
  });
});

describe("sanitizeSmtpError", () => {
  it("corta em 500 caracteres", () => {
    expect(sanitizeSmtpError(new Error("x".repeat(900)))).toHaveLength(500);
  });
});

describe("notifier", () => {
  const routine = { id: 1, name: "Fila <Instagram>", agentKind: "SCRIPT" } as RoutineRow;
  const run = {
    id: 42,
    routineId: 1,
    scheduledFor: new Date(2026, 8, 14, 13, 15).getTime(),
    finishedAt: new Date(2026, 8, 14, 13, 16).getTime(),
    attempt: 1,
    exitCode: 3,
    agentKind: "SCRIPT",
    error: "O comando encerrou com código 3.\n<b>ULTIMA-FALHA</b> & fim"
  } as RunRow;

  it("e-mail de falha traz rotina, tipo, horarios, erro escapado e link", () => {
    const email = buildFailureEmail({ run, routine, panelUrl: "http://127.0.0.1:4090/" });
    expect(email.subject).toBe("[Syntax Routines] Falhou: Fila <Instagram>");
    expect(email.text).toContain("Tipo: Script");
    expect(email.text).toContain("Horário previsto: 14/09/2026, 13:15");
    expect(email.text).toContain("Código de saída: 3");
    expect(email.text).toContain("<b>ULTIMA-FALHA</b> & fim");
    expect(email.html).toContain("Fila &lt;Instagram&gt;");
    expect(email.html).toContain("&lt;b&gt;ULTIMA-FALHA&lt;/b&gt; &amp; fim");
    expect(email.html).not.toContain("<b>ULTIMA-FALHA</b>");
    expect(email.html).toContain('href="http://127.0.0.1:4090/"');
  });

  it("erro comprido e cortado e ausencia de erro tem texto padrao", () => {
    const longRun = { ...run, error: "e".repeat(5000) } as RunRow;
    expect(buildFailureEmail({ run: longRun, routine, panelUrl: "http://x/" }).text).not.toContain("e".repeat(3001));
    const noError = { ...run, error: null, exitCode: null } as RunRow;
    const email = buildFailureEmail({ run: noError, routine, panelUrl: "http://x/" });
    expect(email.text).toContain("Sem detalhe registrado.");
    expect(email.text).toContain("Código de saída: nenhum");
  });

  it("e-mail de teste aponta para o painel", () => {
    const email = buildTestEmail("http://127.0.0.1:4090/");
    expect(email.subject).toBe("[Syntax Routines] E-mail de teste");
    expect(email.text).toContain("http://127.0.0.1:4090/");
  });
});
