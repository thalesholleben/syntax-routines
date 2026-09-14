// Envio de e-mail por SMTP. A conta que envia vem de dois lugares, nesta ordem: a salva em Ajustes pelo painel (senha
// cifrada com DPAPI, ver secret-store.ts) e, sem ela, SMTP_* e MAIL_FROM_* do .env. Quem decide se avisa e para quem
// e o agendador (destinatario em Ajustes). Aqui se envia, se testa a conexao antes de gravar uma conta e se guarda o
// resultado do ultimo envio, que e o selo "Conectado" ou "Falhou" da tela de Ajustes.
import nodemailer from "nodemailer";

import type { Db } from "./db";
import { DEFAULT_LANGUAGE, messages, type Language, type Messages, type TextKey } from "./i18n";
import { dpapiStore, type SecretStore } from "./secret-store";
import { deleteSetting, getSetting, setSetting, writeSettings } from "./settings";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type MailFailure = "notConfigured" | "auth" | "connection" | "notFound" | "tls" | "rejected" | "secret" | "other";
export type MailSource = "panel" | "env";

export interface SmtpConfig {
  host: string;
  port: number;
  isSecure: boolean;
  user: string;
  pass: string;
  fromEmail: string;
  fromName: string;
}

/** O que a tela e o CLI podem ver da conta de envio: nada de senha, nem cifrada. */
export interface MailView {
  isConfigured: boolean;
  source: MailSource | null;
  host: string;
  port: number;
  user: string;
  fromEmail: string;
  status: {
    state: "ok" | "failed" | "untested";
    at: number | null;
    reason: MailFailure | null;
    /** Motivo da falha no idioma pedido; nulo fora de "failed". */
    message: string | null;
    /** Texto do servidor SMTP, ja sem credencial. */
    detail: string | null;
  };
}

/** O que o agendador precisa: saber se da para enviar e enviar. */
export interface Mailer {
  readonly isConfigured: boolean;
  send: (message: MailMessage) => Promise<void>;
}

/** Conta nova ou alterada pelo painel. Senha vazia = manter a que ja esta salva. */
export interface MailAccountInput {
  host: string;
  port: number;
  user: string;
  password: string;
  fromEmail: string;
}

/** O que as rotas de Ajustes usam, alem do envio. */
export interface MailService extends Mailer {
  describe: (language?: Language) => MailView;
  /** Com conta: testa a conexao e so entao grava conta e destinatario (falhou, nada muda). Sem conta: so o destinatario. */
  save: (input: { account: MailAccountInput | null; notifyEmail: string }) => Promise<void>;
  /** Apaga a conta salva pelo painel; o .env, se houver, volta a valer. */
  remove: () => void;
}

/** Transporte minimo; o do nodemailer serve, e o teste injeta um falso. */
export interface MailTransport {
  sendMail: (mail: { from: { name: string; address: string }; to: string; subject: string; text: string; html: string }) => Promise<unknown>;
  verify: () => Promise<unknown>;
}

export type TransportFactory = (config: SmtpConfig) => MailTransport;

const DEFAULT_FROM_NAME = "Syntax Routines";

// Chaves da tabela settings. A senha so existe cifrada; `readSettings` nao le nenhuma delas.
const KEY = {
  host: "smtp_host",
  port: "smtp_port",
  user: "smtp_user",
  fromEmail: "mail_from_email",
  passBlob: "smtp_pass_dpapi",
  status: "mail_status"
} as const;

const FAILURE_TEXT: Record<MailFailure, TextKey> = {
  notConfigured: "mailNotConfigured",
  auth: "mailFailAuth",
  connection: "mailFailConnection",
  notFound: "mailFailNotFound",
  tls: "mailFailTls",
  rejected: "mailFailRejected",
  secret: "mailFailSecret",
  other: "mailFailOther"
};

function isMailFailure(value: unknown): value is MailFailure {
  return typeof value === "string" && Object.hasOwn(FAILURE_TEXT, value);
}

function failureText(m: Messages, reason: MailFailure, detail: string): string {
  const text = m[FAILURE_TEXT[reason]];
  return detail ? m.mailFailDetail(text, detail) : text;
}

/** Falha de envio que sabe se traduzir: `message` em portugues (log e CLI), `localized(lang)` para a API. */
export class MailError extends Error {
  readonly reason: MailFailure;
  readonly detail: string;

  constructor(reason: MailFailure, detail = "") {
    super(failureText(messages(DEFAULT_LANGUAGE), reason, detail));
    this.reason = reason;
    this.detail = detail;
  }

  localized(language: Language): string {
    return failureText(messages(language), this.reason, this.detail);
  }
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
    fromName: env.MAIL_FROM_NAME?.trim() || DEFAULT_FROM_NAME
  };
}

/**
 * Texto de erro do SMTP que pode ir para o painel. Os padroes cobrem os formatos comuns; os `secrets`
 * (a senha e o usuario da conta) sao apagados literalmente, para o servidor que ecoa a credencial em
 * qualquer outro formato nao vazar nada por aqui.
 */
export function sanitizeSmtpError(error: unknown, secrets: readonly string[] = []): string {
  const raw = error instanceof Error ? error.message : String(error);
  let text = raw;
  for (const secret of secrets) {
    if (secret.length > 0) text = text.split(secret).join("[redacted]");
  }
  // Depois de AUTH vem o mecanismo e a credencial em base64: some tudo ate o fim da linha.
  return text
    .replace(/(pass(?:word)?|token|secret)=\S+/gi, "$1=[redacted]")
    .replace(/\bAUTH\b.*$/gim, "AUTH [redacted]")
    .slice(0, 500);
}

/** Motivo da falha pelo codigo do nodemailer, para a tela dizer o que conferir. */
export function classifySmtpError(error: unknown): MailFailure {
  const { code, responseCode } = (typeof error === "object" && error !== null ? error : {}) as { code?: unknown; responseCode?: unknown };
  const text = error instanceof Error ? error.message : String(error);
  if (code === "EAUTH" || code === "ENOAUTH" || responseCode === 530 || responseCode === 534 || responseCode === 535) return "auth";
  if (code === "EDNS" || /\b(ENOTFOUND|EAI_AGAIN)\b/.test(text)) return "notFound";
  // TLS antes de conexao: porta trocada (SSL na 587) chega como ESOCKET com "wrong version number".
  if (code === "ETLS" || /STARTTLS|SSL routines|wrong version number|certificate/i.test(text)) return "tls";
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b/.test(text)) return "connection";
  if (code === "EENVELOPE" || (typeof responseCode === "number" && responseCode >= 500)) return "rejected";
  return "other";
}

/** Relay no proprio PC (127.0.0.1, localhost) nao exige STARTTLS: o trafego nao sai da maquina. */
export function isLoopbackHost(host: string): boolean {
  return /^(localhost|127(?:\.\d{1,3}){3}|::1|\[::1\])$/i.test(host.trim());
}

export const nodemailerTransport: TransportFactory = (config) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.isSecure,
    requireTLS: !config.isSecure && !isLoopbackHost(config.host),
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000
  });

type Account = { source: "panel"; config: Omit<SmtpConfig, "pass">; passBlob: string } | { source: "env"; config: SmtpConfig };

function panelAccount(db: Db): { config: Omit<SmtpConfig, "pass">; passBlob: string } | null {
  const host = getSetting(db, KEY.host);
  const port = Number(getSetting(db, KEY.port));
  const user = getSetting(db, KEY.user);
  const fromEmail = getSetting(db, KEY.fromEmail);
  const passBlob = getSetting(db, KEY.passBlob);
  if (!host || !user || !fromEmail || !passBlob || !Number.isInteger(port) || port <= 0) return null;
  return { config: { host, port, isSecure: port === 465, user, fromEmail, fromName: DEFAULT_FROM_NAME }, passBlob };
}

function currentAccount(db: Db, env: NodeJS.ProcessEnv): Account | null {
  const panel = panelAccount(db);
  if (panel) return { source: "panel", ...panel };
  const config = readSmtpConfig(env);
  return config.fromEmail && config.user && config.pass ? { source: "env", config } : null;
}

/** Impressao da conta sem a senha: o resultado gravado para outra conta nao vale para esta. */
function statusKey(source: MailSource, config: Omit<SmtpConfig, "pass">): string {
  return [source, config.host, config.port, config.isSecure, config.user, config.fromEmail].join("|");
}

interface StoredStatus {
  key: string;
  state: "ok" | "failed";
  at: number;
  reason: MailFailure | null;
  detail: string | null;
}

function readStoredStatus(db: Db): StoredStatus | null {
  const raw = getSetting(db, KEY.status);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredStatus>;
    if (typeof value.key !== "string" || (value.state !== "ok" && value.state !== "failed") || typeof value.at !== "number") return null;
    return { key: value.key, state: value.state, at: value.at, reason: isMailFailure(value.reason) ? value.reason : null, detail: value.detail ?? null };
  } catch {
    return null;
  }
}

const UNTESTED: MailView["status"] = { state: "untested", at: null, reason: null, message: null, detail: null };

/** Retrato da conta de envio para a tela e para o CLI. Nao abre a senha: nao chama o PowerShell. */
export function describeMail(db: Db, env: NodeJS.ProcessEnv, language: Language = DEFAULT_LANGUAGE): MailView {
  const account = currentAccount(db, env);
  if (!account) return { isConfigured: false, source: null, host: "", port: 0, user: "", fromEmail: "", status: UNTESTED };
  const stored = readStoredStatus(db);
  const status: MailView["status"] =
    stored && stored.key === statusKey(account.source, account.config)
      ? {
          state: stored.state,
          at: stored.at,
          reason: stored.reason,
          message: stored.state === "failed" && stored.reason ? messages(language)[FAILURE_TEXT[stored.reason]] : null,
          detail: stored.detail
        }
      : UNTESTED;
  return {
    isConfigured: true,
    source: account.source,
    host: account.config.host,
    port: account.config.port,
    user: account.config.user,
    fromEmail: account.config.fromEmail,
    status
  };
}

/** A senha de app do Google aparece em blocos com espaco; o SMTP quer as 16 letras juntas. */
function normalizePassword(host: string, password: string): string {
  const trimmed = password.trim();
  return host.trim().toLowerCase() === "smtp.gmail.com" ? trimmed.replace(/\s+/g, "") : trimmed;
}

function transaction(db: Db, work: () => void): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export interface MailerDeps {
  db: Db;
  /** Lido a cada uso (nao so na criacao): o teste muda o ambiente no meio. */
  env?: NodeJS.ProcessEnv;
  secrets?: SecretStore;
  createTransport?: TransportFactory;
  now?: () => number;
}

export function createMailer({ db, env = process.env, secrets = dpapiStore, createTransport = nodemailerTransport, now = Date.now }: MailerDeps): MailService {
  // A senha aberta fica em memoria so para a conta atual: abrir custa um PowerShell.
  let opened: { blob: string; pass: string } | null = null;

  async function openPassword(blob: string): Promise<string> {
    if (opened?.blob === blob) return opened.pass;
    let pass: string;
    try {
      pass = await secrets.unprotect(blob);
    } catch {
      throw new MailError("secret");
    }
    opened = { blob, pass };
    return pass;
  }

  function recordStatus(key: string, failure: MailError | null): void {
    const value: StoredStatus = failure
      ? { key, state: "failed", at: now(), reason: failure.reason, detail: failure.detail || null }
      : { key, state: "ok", at: now(), reason: null, detail: null };
    setSetting(db, KEY.status, JSON.stringify(value));
  }

  function toMailError(error: unknown, config: SmtpConfig): MailError {
    return error instanceof MailError ? error : new MailError(classifySmtpError(error), sanitizeSmtpError(error, [config.pass, config.user]));
  }

  return {
    get isConfigured() {
      return currentAccount(db, env) !== null;
    },

    describe(language = DEFAULT_LANGUAGE) {
      return describeMail(db, env, language);
    },

    async send(message) {
      const account = currentAccount(db, env);
      if (!account) throw new MailError("notConfigured");
      const key = statusKey(account.source, account.config);
      let config: SmtpConfig;
      try {
        config = account.source === "panel" ? { ...account.config, pass: await openPassword(account.passBlob) } : account.config;
      } catch (error) {
        const failure = error instanceof MailError ? error : new MailError("secret");
        recordStatus(key, failure);
        throw failure;
      }
      try {
        await createTransport(config).sendMail({
          from: { name: config.fromName, address: config.fromEmail },
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html
        });
      } catch (error) {
        const failure = toMailError(error, config);
        recordStatus(key, failure);
        throw failure;
      }
      recordStatus(key, null);
    },

    async save({ account, notifyEmail }) {
      if (!account) {
        writeSettings(db, { notifyEmail });
        return;
      }
      const stored = panelAccount(db);
      const typed = normalizePassword(account.host, account.password);
      const pass = typed || (stored ? await openPassword(stored.passBlob) : "");
      if (!pass) throw new MailError("notConfigured");
      const config: SmtpConfig = {
        host: account.host,
        port: account.port,
        isSecure: account.port === 465,
        user: account.user,
        pass,
        fromEmail: account.fromEmail,
        fromName: DEFAULT_FROM_NAME
      };
      try {
        await createTransport(config).verify();
      } catch (error) {
        throw toMailError(error, config);
      }
      let blob = stored?.passBlob ?? "";
      if (typed) {
        try {
          blob = await secrets.protect(typed);
        } catch {
          throw new MailError("secret");
        }
        opened = { blob, pass: typed };
      }
      transaction(db, () => {
        setSetting(db, KEY.host, config.host);
        setSetting(db, KEY.port, String(config.port));
        setSetting(db, KEY.user, config.user);
        setSetting(db, KEY.fromEmail, config.fromEmail);
        setSetting(db, KEY.passBlob, blob);
        writeSettings(db, { notifyEmail });
        recordStatus(statusKey("panel", config), null);
      });
    },

    remove() {
      transaction(db, () => {
        for (const key of Object.values(KEY)) deleteSetting(db, key);
      });
      opened = null;
    }
  };
}
