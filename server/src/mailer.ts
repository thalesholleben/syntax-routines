// Envio de e-mail por SMTP, no mesmo esquema dos outros produtos da SyntaxLab: SMTP_* e MAIL_FROM_* vindos do ambiente (o .env do
// projeto). Quem decide se avisa e para quem e o agendador (destinatario em Ajustes); aqui so se envia.
import nodemailer from "nodemailer";

import { DEFAULT_LANGUAGE, messages, type Language } from "./i18n";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  /** Remetente, usuario e senha presentes. Sem isso, `send` recusa antes de abrir conexao. */
  isConfigured: boolean;
  /** Remetente (para a tela de Ajustes mostrar de onde o aviso sai). */
  from: string;
  send: (message: MailMessage) => Promise<void>;
}

/** Transporte minimo que o mailer usa; o do nodemailer serve, e o teste injeta um falso. */
export interface MailTransport {
  sendMail: (mail: {
    from: { name: string; address: string };
    to: string;
    subject: string;
    text: string;
    html: string;
  }) => Promise<unknown>;
}

/** Falha de envio que sabe se traduzir: `message` em portugues (log e CLI), `localized(lang)` para a API. */
export class MailError extends Error {
  readonly key: "smtpNotConfiguredEnv" | "smtpRejected";
  readonly detail: string;

  constructor(key: "smtpNotConfiguredEnv" | "smtpRejected", detail = "") {
    super(key === "smtpRejected" ? messages(DEFAULT_LANGUAGE).smtpRejected(detail) : messages(DEFAULT_LANGUAGE).smtpNotConfiguredEnv);
    this.key = key;
    this.detail = detail;
  }

  localized(language: Language): string {
    const m = messages(language);
    return this.key === "smtpRejected" ? m.smtpRejected(this.detail) : m.smtpNotConfiguredEnv;
  }
}

interface SmtpConfig {
  host: string;
  port: number;
  isSecure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function readSmtpConfig(env: NodeJS.ProcessEnv): SmtpConfig {
  const port = Number(env.SMTP_PORT?.trim() || 587);
  return {
    host: env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port,
    isSecure: parseBoolean(env.SMTP_SECURE) ?? port === 465,
    user: env.SMTP_USER?.trim() ?? "",
    pass: env.SMTP_PASS?.trim() ?? "",
    fromEmail: env.MAIL_FROM_EMAIL?.trim() ?? "",
    fromName: env.MAIL_FROM_NAME?.trim() || "Syntax Routines"
  };
}

/** Mensagem de erro do SMTP sem credencial: senha, token e o comando AUTH nunca chegam ao log nem a tela. */
export function sanitizeSmtpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  // Depois de AUTH vem o mecanismo e a credencial em base64: some tudo ate o fim da linha.
  return raw
    .replace(/(pass(?:word)?|token|secret)=\S+/gi, "$1=[redacted]")
    .replace(/\bAUTH\b.*$/gim, "AUTH [redacted]")
    .slice(0, 500);
}

export function createMailer(env: NodeJS.ProcessEnv = process.env, transport?: MailTransport): Mailer {
  const config = readSmtpConfig(env);
  const isConfigured = Boolean(config.fromEmail && config.user && config.pass);
  let cached: MailTransport | undefined = transport;

  function getTransport(): MailTransport {
    if (!cached) {
      cached = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.isSecure,
        requireTLS: !config.isSecure,
        auth: { user: config.user, pass: config.pass },
        connectionTimeout: 20_000,
        greetingTimeout: 20_000,
        socketTimeout: 30_000
      });
    }
    return cached;
  }

  return {
    isConfigured,
    from: config.fromEmail,
    async send(message) {
      if (!isConfigured) throw new MailError("smtpNotConfiguredEnv");
      try {
        await getTransport().sendMail({
          from: { name: config.fromName, address: config.fromEmail },
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html
        });
      } catch (error) {
        throw new MailError("smtpRejected", sanitizeSmtpError(error));
      }
    }
  };
}
