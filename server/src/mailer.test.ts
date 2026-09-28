import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "./db";
import {
  classifySmtpError,
  createMailer,
  describeMail,
  isDeliveryUncertain,
  isLoopbackHost,
  MailError,
  nodemailerTransport,
  readSmtpConfig,
  sanitizeSmtpError,
  type SmtpConfig,
  type TransportFactory
} from "./mailer";
import { buildFailureEmail, buildTestEmail } from "./notifier";
import type { RoutineRow, RunRow } from "./routines";
import type { SecretStore } from "./secret-store";
import { readSettings } from "./settings";

const env = {
  SMTP_USER: "avisos@example.com",
  SMTP_PASS: "senha-de-app",
  MAIL_FROM_EMAIL: "avisos@example.com",
  MAIL_FROM_NAME: "Syntax Routines Teste"
};
const message = { to: "dono@example.com", subject: "Teste", text: "corpo", html: "<p>corpo</p>" };
const account = { host: "smtp.gmail.com", port: 587, user: "painel@example.com", password: "abcd efgh ijkl mnop", fromEmail: "painel@example.com" };

let tmp = "";
let db: Db;
let clock = 0;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-mailer-")));
  db = openDb(path.join(tmp, "app.db"));
  clock = new Date(2026, 8, 14, 18, 0).getTime();
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Cofre falso: a senha fica num Map e o banco recebe so um apelido. */
function fakeSecrets() {
  const vault = new Map<string, string>();
  const calls = { protect: 0, unprotect: 0 };
  const forgotten: string[] = [];
  const control = { isForgetBroken: false };
  const store: SecretStore = {
    async forget(blob) {
      forgotten.push(blob);
      if (control.isForgetBroken) throw new Error("cofre recusou apagar");
      vault.delete(blob);
    },
    async protect(plain) {
      calls.protect += 1;
      const blob = `b10b${vault.size + 1}`;
      vault.set(blob, plain);
      return blob;
    },
    async unprotect(blob) {
      calls.unprotect += 1;
      const plain = vault.get(blob);
      if (plain === undefined) throw new Error("blob desconhecido");
      return plain;
    }
  };
  return { store, vault, calls, forgotten, control };
}

/** Transporte falso: guarda a config de cada conexao e falha quando o teste manda. */
function fakeTransport() {
  const state = {
    sent: [] as { config: SmtpConfig; to: string; from: { name: string; address: string } }[],
    verified: [] as SmtpConfig[],
    sendError: null as unknown,
    verifyError: null as unknown
  };
  const factory: TransportFactory = (config) => ({
    async sendMail(mail) {
      if (state.sendError) throw state.sendError;
      state.sent.push({ config, to: mail.to, from: mail.from });
    },
    async verify() {
      state.verified.push(config);
      if (state.verifyError) throw state.verifyError;
    }
  });
  return { factory, state };
}

function smtpError(text: string, props: Record<string, unknown>): Error {
  return Object.assign(new Error(text), props);
}

function settingsRows(): string {
  return JSON.stringify(db.prepare("SELECT key, value FROM settings").all());
}

describe("readSmtpConfig", () => {
  it("padroes do gmail, 587 com STARTTLS, 465 e segura", () => {
    expect(readSmtpConfig({})).toMatchObject({ host: "smtp.gmail.com", port: 587, isSecure: false, fromName: "Routines SyntaxLab" });
    expect(readSmtpConfig({ SMTP_PORT: "465" })).toMatchObject({ port: 465, isSecure: true });
    expect(readSmtpConfig({ SMTP_PORT: "465", SMTP_SECURE: "false" })).toMatchObject({ isSecure: false });
  });
});

describe("classifySmtpError e transporte", () => {
  it("traduz o codigo do nodemailer no que a pessoa precisa conferir", () => {
    expect(classifySmtpError(smtpError("Invalid login: 535-5.7.8 Username and Password not accepted", { code: "EAUTH", responseCode: 535 }))).toBe("auth");
    expect(classifySmtpError(smtpError("getaddrinfo ENOTFOUND smtp.gmial.com", { code: "EDNS" }))).toBe("notFound");
    expect(classifySmtpError(smtpError("SSL routines:ssl3_get_record:wrong version number", { code: "ESOCKET" }))).toBe("tls");
    expect(classifySmtpError(smtpError("connect ECONNREFUSED 127.0.0.1:1", { code: "ESOCKET" }))).toBe("connection");
    expect(classifySmtpError(smtpError("Greeting never received", { code: "ETIMEDOUT" }))).toBe("connection");
    expect(classifySmtpError(smtpError("Can't send mail - all recipients were rejected", { code: "EENVELOPE", responseCode: 550 }))).toBe("rejected");
    expect(classifySmtpError(new Error("algo estranho"))).toBe("other");
  });

  it("so o proprio PC dispensa o STARTTLS", () => {
    expect(["127.0.0.1", "localhost", "::1", "[::1]", "127.0.0.9"].every(isLoopbackHost)).toBe(true);
    expect(["smtp.gmail.com", "10.0.0.5", "127.0.0.1.nip.io"].some(isLoopbackHost)).toBe(false);
    const base: SmtpConfig = { host: "smtp.gmail.com", port: 587, isSecure: false, user: "u", pass: "p", fromEmail: "u@example.com", fromName: "x" };
    const requireTls = (config: SmtpConfig) => {
      const transport = nodemailerTransport(config) as unknown as { options?: { requireTLS?: boolean }; transporter?: { options?: { requireTLS?: boolean } } };
      return transport.transporter?.options?.requireTLS ?? transport.options?.requireTLS;
    };
    expect(requireTls(base)).toBe(true);
    expect(requireTls({ ...base, host: "127.0.0.1" })).toBe(false);
    expect(requireTls({ ...base, port: 465, isSecure: true })).toBe(false);
  });
});

/**
 * SMTP de verdade no loopback que erra de proposito numa fase: fecha a conexao ao receber o RCPT (antes da mensagem),
 * fecha logo depois do ponto final do DATA sem responder (a confirmacao se perdeu) ou recusa a mensagem com 550.
 */
const CRLF = "\r\n";

async function misbehavingSmtp(mode: "dropOnRcpt" | "dropAfterData" | "rejectAfterData") {
  const received: string[] = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    socket.on("error", () => undefined);
    let buffer = "";
    let isData = false;
    const reply = (line: string) => socket.write(`${line}${CRLF}`);
    reply("220 teste ESMTP");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (isData) {
          const end = buffer.indexOf(`${CRLF}.${CRLF}`);
          if (end === -1) return;
          received.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          isData = false;
          if (mode === "dropAfterData") socket.destroy();
          else reply("550 5.7.1 mensagem recusada");
          return;
        }
        const newline = buffer.indexOf(CRLF);
        if (newline === -1) return;
        const verb = buffer.slice(0, newline).split(" ")[0].toUpperCase();
        buffer = buffer.slice(newline + 2);
        if (verb === "EHLO") reply(`250-teste${CRLF}250 AUTH PLAIN`);
        else if (verb === "AUTH") reply("235 2.7.0 ok");
        else if (verb === "MAIL") reply("250 2.1.0 ok");
        else if (verb === "RCPT") {
          if (mode === "dropOnRcpt") return void socket.destroy();
          reply("250 2.1.5 ok");
        } else if (verb === "DATA") {
          isData = true;
          reply("354 manda");
        } else if (verb === "QUIT") reply("221 tchau");
        else reply("250 ok");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return { port, received, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function loopbackEnv(port: number) {
  return { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(port), SMTP_USER: "avisos@example.com", SMTP_PASS: "senha", MAIL_FROM_EMAIL: "avisos@example.com" };
}

async function sendError(port: number): Promise<MailError> {
  const mailer = createMailer({ db, env: loopbackEnv(port) });
  const error = await mailer.send(message).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(MailError);
  return error as MailError;
}

describe("entrega incerta: a mensagem saiu inteira e o servidor nao confirmou", () => {
  it("so a marca de mensagem enviada sem recusa 4xx/5xx conta como incerta", () => {
    expect(isDeliveryUncertain(smtpError("Connection closed unexpectedly", { code: "ECONNECTION", command: "CONN", isMessageSent: true }))).toBe(true);
    expect(isDeliveryUncertain(smtpError("Timeout", { code: "ETIMEDOUT", command: "CONN", isMessageSent: true }))).toBe(true);
    expect(isDeliveryUncertain(smtpError("Message failed: 550", { code: "EMESSAGE", command: "DATA", responseCode: 550, isMessageSent: true }))).toBe(false);
    expect(isDeliveryUncertain(smtpError("Message failed: 451", { code: "EMESSAGE", command: "DATA", responseCode: 451, isMessageSent: true }))).toBe(false);
    // O mesmo ETIMEDOUT/CONN antes da mensagem sair (sem internet, servidor calado) continua podendo tentar de novo.
    expect(isDeliveryUncertain(smtpError("Timeout", { code: "ETIMEDOUT", command: "CONN" }))).toBe(false);
    expect(isDeliveryUncertain(new Error("qualquer"))).toBe(false);
  });

  it("conexao que cai depois do ponto final do DATA vira MailError incerto", async () => {
    const smtp = await misbehavingSmtp("dropAfterData");
    try {
      const error = await sendError(smtp.port);
      expect(smtp.received).toHaveLength(1);
      expect(error.isDeliveryUncertain).toBe(true);
    } finally {
      await smtp.close();
    }
  });

  it("recusa 550 depois do DATA, queda antes da mensagem e porta fechada nao sao incertas", async () => {
    const rejecting = await misbehavingSmtp("rejectAfterData");
    const dropping = await misbehavingSmtp("dropOnRcpt");
    try {
      const rejected = await sendError(rejecting.port);
      expect(rejecting.received).toHaveLength(1);
      expect(rejected).toMatchObject({ reason: "rejected", isDeliveryUncertain: false });
      const dropped = await sendError(dropping.port);
      expect(dropping.received).toHaveLength(0);
      expect(dropped.isDeliveryUncertain).toBe(false);
    } finally {
      await rejecting.close();
      await dropping.close();
    }
    const closed = await misbehavingSmtp("dropOnRcpt");
    await closed.close();
    expect(await sendError(closed.port)).toMatchObject({ reason: "connection", isDeliveryUncertain: false });
  });
});

describe("createMailer com a conta do .env", () => {
  it("sem remetente, usuario ou senha fica desconfigurado e recusa antes de conectar", async () => {
    const { factory, state } = fakeTransport();
    const mailer = createMailer({ db, env: { SMTP_USER: "x", SMTP_PASS: "y" }, secrets: fakeSecrets().store, createTransport: factory });
    expect(mailer.isConfigured).toBe(false);
    expect(mailer.describe()).toMatchObject({ isConfigured: false, source: null, status: { state: "untested" } });
    const error = await mailer.send(message).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).reason).toBe("notConfigured");
    expect(state.sent).toHaveLength(0);
  });

  it("monta a mensagem com remetente nomeado pelo nodemailer de verdade (jsonTransport) e marca o selo", async () => {
    const json = nodemailer.createTransport({ jsonTransport: true });
    const sent: unknown[] = [];
    const factory: TransportFactory = () => ({
      sendMail: async (mail) => {
        const info = await json.sendMail(mail);
        sent.push(JSON.parse(info.message as string));
        return info;
      },
      verify: async () => true
    });
    const mailer = createMailer({ db, env, secrets: fakeSecrets().store, createTransport: factory, now: () => clock });
    expect(mailer.describe()).toMatchObject({ isConfigured: true, source: "env", host: "smtp.gmail.com", port: 587, fromEmail: "avisos@example.com", status: { state: "untested" } });
    await mailer.send(message);
    expect(sent[0]).toMatchObject({
      from: { address: "avisos@example.com", name: "Syntax Routines Teste" },
      to: [{ address: "dono@example.com" }],
      subject: "Teste",
      text: "corpo",
      html: "<p>corpo</p>"
    });
    expect(mailer.describe().status).toEqual({ state: "ok", at: clock, reason: null, message: null, detail: null });
  });

  it("falha do SMTP vira MailError com motivo e sem credencial, e o selo mostra a falha no idioma pedido", async () => {
    const { factory, state } = fakeTransport();
    state.sendError = smtpError(`Invalid login: 535 AUTH PLAIN dXNlcjpzZW5oYQ== pass=${env.SMTP_PASS} for ${env.SMTP_USER}`, { code: "EAUTH", responseCode: 535 });
    const mailer = createMailer({ db, env, secrets: fakeSecrets().store, createTransport: factory, now: () => clock });
    const error = (await mailer.send(message).catch((err: unknown) => err)) as MailError;
    expect(error).toBeInstanceOf(MailError);
    expect(error.reason).toBe("auth");
    expect(error.detail).toBe("Invalid login: 535 AUTH [redacted]");
    expect(error.message).toBe(
      "O servidor recusou o e-mail ou a senha. No Gmail, use uma senha de app, não a senha da conta. Detalhe: Invalid login: 535 AUTH [redacted]"
    );
    expect(mailer.describe("en").status).toEqual({
      state: "failed",
      at: clock,
      reason: "auth",
      message: "The server rejected the e-mail or the password. On Gmail, use an app password, not the account password.",
      detail: "Invalid login: 535 AUTH [redacted]"
    });
    expect(sanitizeSmtpError(new Error("connect failed password=abc token=xyz"))).toBe("connect failed password=[redacted] token=[redacted]");
  });

  it("a senha e o usuario somem do detalhe em qualquer formato que o SMTP os ecoe", async () => {
    const { factory, state } = fakeTransport();
    state.sendError = new Error(`SMTP rejected password: ${env.SMTP_PASS} for ${env.SMTP_USER} (retry with ${env.SMTP_PASS})`);
    const mailer = createMailer({ db, env, secrets: fakeSecrets().store, createTransport: factory });
    const error = (await mailer.send(message).catch((err: unknown) => err)) as MailError;
    expect(error.detail).toBe("SMTP rejected password: [redacted] for [redacted] (retry with [redacted])");
    expect(error.message).not.toContain(env.SMTP_PASS);
    expect(error.localized("en")).not.toContain(env.SMTP_PASS);
    expect(settingsRows()).not.toContain(env.SMTP_PASS);
  });

  it("o resultado gravado vale so para a conta que o produziu", async () => {
    const { factory } = fakeTransport();
    const mutable: NodeJS.ProcessEnv = { ...env };
    const mailer = createMailer({ db, env: mutable, secrets: fakeSecrets().store, createTransport: factory, now: () => clock });
    await mailer.send(message);
    expect(mailer.describe().status.state).toBe("ok");
    mutable.SMTP_HOST = "smtp.outro.com";
    expect(mailer.describe()).toMatchObject({ host: "smtp.outro.com", status: { state: "untested" } });
  });

  it("status corrompido no banco vira Nao testado, sem quebrar a tela", () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('mail_status', '{quebrado')").run();
    expect(describeMail(db, env).status.state).toBe("untested");
  });
});

describe("createMailer com a conta salva pelo painel", () => {
  it("testa antes de gravar, cifra a senha, grava o destinatario e passa a valer mais que o .env", async () => {
    const secrets = fakeSecrets();
    const { factory, state } = fakeTransport();
    const mailer = createMailer({ db, env, secrets: secrets.store, createTransport: factory, now: () => clock });
    await mailer.save({ account, notifyEmail: "dono@example.com" });

    // Senha de app do Google chega com espacos; o SMTP recebe as 16 letras juntas.
    expect(state.verified).toHaveLength(1);
    expect(state.verified[0]).toMatchObject({ host: "smtp.gmail.com", port: 587, isSecure: false, user: "painel@example.com", pass: "abcdefghijklmnop" });
    expect([...secrets.vault.values()]).toEqual(["abcdefghijklmnop"]);
    expect(settingsRows()).not.toContain("abcdefghijklmnop");
    expect(settingsRows()).not.toContain("abcd efgh");
    expect(readSettings(db).notifyEmail).toBe("dono@example.com");
    expect(mailer.describe()).toMatchObject({ isConfigured: true, source: "panel", fromEmail: "painel@example.com", status: { state: "ok", at: clock } });
    expect(JSON.stringify(mailer.describe())).not.toContain("b10b");

    await mailer.send(message);
    expect(state.sent[0].config).toMatchObject({ user: "painel@example.com", pass: "abcdefghijklmnop" });
    expect(state.sent[0].from).toEqual({ name: "Routines SyntaxLab", address: "painel@example.com" });
  });

  it("falhou o teste, nada muda: nem conta, nem destinatario, nem cofre", async () => {
    const secrets = fakeSecrets();
    const { factory, state } = fakeTransport();
    state.verifyError = smtpError("connect ECONNREFUSED 10.0.0.1:587", { code: "ESOCKET" });
    const mailer = createMailer({ db, env, secrets: secrets.store, createTransport: factory });
    const error = (await mailer.save({ account, notifyEmail: "dono@example.com" }).catch((err: unknown) => err)) as MailError;
    expect(error).toBeInstanceOf(MailError);
    expect(error.reason).toBe("connection");
    expect(secrets.calls.protect).toBe(0);
    expect(readSettings(db).notifyEmail).toBe("");
    expect(mailer.describe().source).toBe("env");
  });

  it("senha em branco mantem a salva; sem conta, grava so o destinatario e nao testa nada", async () => {
    const secrets = fakeSecrets();
    const { factory, state } = fakeTransport();
    const mailer = createMailer({ db, env: {}, secrets: secrets.store, createTransport: factory });
    await mailer.save({ account, notifyEmail: "dono@example.com" });
    await mailer.save({ account: { ...account, password: "  ", user: "outro@example.com", fromEmail: "outro@example.com" }, notifyEmail: "dono@example.com" });
    expect(state.verified[1]).toMatchObject({ user: "outro@example.com", pass: "abcdefghijklmnop" });
    expect(secrets.calls.protect).toBe(1);

    await mailer.save({ account: null, notifyEmail: "novo@example.com" });
    expect(state.verified).toHaveLength(2);
    expect(readSettings(db).notifyEmail).toBe("novo@example.com");
    expect(mailer.describe()).toMatchObject({ source: "panel", fromEmail: "outro@example.com" });
  });

  it("senha salva que o Windows nao abre vira o motivo 'secret' no envio e no selo", async () => {
    const secrets = fakeSecrets();
    const { factory } = fakeTransport();
    await createMailer({ db, env: {}, secrets: secrets.store, createTransport: factory, now: () => clock }).save({ account, notifyEmail: "dono@example.com" });
    secrets.vault.clear();
    // Outra instancia, como o app reiniciado: sem a senha aberta em memoria.
    const restarted = createMailer({ db, env: {}, secrets: secrets.store, createTransport: factory, now: () => clock + 1000 });
    const error = (await restarted.send(message).catch((err: unknown) => err)) as MailError;
    expect(error.reason).toBe("secret");
    expect(restarted.describe().status).toMatchObject({ state: "failed", reason: "secret", at: clock + 1000 });
  });

  it("remover a conta do painel devolve o .env, apaga o selo e mantem o destinatario", async () => {
    const { factory } = fakeTransport();
    const mailer = createMailer({ db, env, secrets: fakeSecrets().store, createTransport: factory });
    await mailer.save({ account, notifyEmail: "dono@example.com" });
    expect(mailer.describe().source).toBe("panel");
    await mailer.remove();
    expect(mailer.describe()).toMatchObject({ source: "env", fromEmail: "avisos@example.com", status: { state: "untested" } });
    expect(settingsRows()).not.toMatch(/smtp_|mail_status|mail_from_email/);
    expect(readSettings(db).notifyEmail).toBe("dono@example.com");
  });
});

describe("createMailer limpa o cofre do sistema", () => {
  it("senha nova apaga o item antigo do cofre; senha em branco nao apaga nada", async () => {
    const secrets = fakeSecrets();
    const { factory } = fakeTransport();
    const mailer = createMailer({ db, env: {}, secrets: secrets.store, createTransport: factory });
    await mailer.save({ account, notifyEmail: "dono@example.com" });
    const [first] = secrets.vault.keys();
    await mailer.save({ account: { ...account, password: "  " }, notifyEmail: "dono@example.com" });
    expect(secrets.forgotten).toEqual([]);
    await mailer.save({ account: { ...account, password: "senha-nova" }, notifyEmail: "dono@example.com" });
    expect(secrets.forgotten).toEqual([first]);
    expect([...secrets.vault.values()]).toEqual(["senha-nova"]);
  });

  it("remover apaga o item do cofre, e cofre que recusa apagar nao impede a remocao da conta", async () => {
    const secrets = fakeSecrets();
    const { factory } = fakeTransport();
    const mailer = createMailer({ db, env: {}, secrets: secrets.store, createTransport: factory });
    await mailer.save({ account, notifyEmail: "dono@example.com" });
    const [blob] = secrets.vault.keys();
    secrets.control.isForgetBroken = true;
    await mailer.remove();
    expect(secrets.forgotten).toEqual([blob]);
    expect(mailer.describe()).toMatchObject({ isConfigured: false, source: null });
    expect(settingsRows()).not.toMatch(/smtp_|mail_status/);
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
    expect(email.html).toContain(">E-mail de teste do Syntax Routines</h1>");
    expect(email.html).toContain('<span style="white-space:nowrap;">e-mail</span> de teste');
    expect(email.html).toContain('class="em-btn__link" href="http://127.0.0.1:4090/"');
  });

  it("falha no layout claro aprovado: marca SyntaxLab, selo, preheader, erro em bloco e botao do painel", () => {
    const { html } = buildFailureEmail({ run, routine, panelUrl: "http://127.0.0.1:4090/" });
    expect(html).toContain('<html lang="pt-BR"');
    expect(html).toContain('bgcolor="#f2f2ef"');
    expect(html).not.toContain("#0a0a0a");
    expect(html).toContain('src="https://syntaxlab.com.br/images/email/logo-syntaxlab.png" width="131" height="21" alt="SyntaxLab"');
    expect(html).toContain(">Aviso interno</span>");
    expect(html).toContain(">Falhou</span>");
    expect(html).toContain(">A rotina Fila &lt;Instagram&gt; falhou</h1>");
    expect(html).toContain("Script, tentativa 1, código de saída 3. O erro completo está no e-mail.");
    expect(html).toContain("white-space:pre-wrap;word-break:break-word;\">O comando encerrou com código 3.\n&lt;b&gt;ULTIMA-FALHA&lt;/b&gt;");
    expect(html).toContain("Software sob medida<br>");
    expect(html).toContain("Aviso automático do Syntax Routines instalado neste computador.");
    expect(html).not.toContain("{{");
  });

  it("layout em ingles quando o idioma e en", () => {
    const { html, subject } = buildFailureEmail({ run, routine, panelUrl: "http://x/", language: "en" });
    expect(subject).toBe("[Syntax Routines] Failed: Fila <Instagram>");
    expect(html).toContain('<html lang="en-US"');
    expect(html).toContain(">Internal notice</span>");
    expect(html).toContain(">Failed</span>");
    expect(html).toContain("Custom software<br>");
    expect(html).toContain(">Open the panel</a>");
    expect(buildTestEmail("http://x/", "en").html).toContain(">Syntax Routines test e-mail</h1>");
  });

  it("nome da rotina nao quebra o assunto nem vira placeholder do layout", () => {
    const tricky = { ...routine, name: "Linha 1\r\nBcc: x@example.com {{corpo}}" } as RoutineRow;
    const email = buildFailureEmail({ run, routine: tricky, panelUrl: "http://x/" });
    expect(email.subject).toBe("[Syntax Routines] Falhou: Linha 1 Bcc: x@example.com {{corpo}}");
    expect(email.html).toContain("{{corpo}}");
    expect(email.html.match(/em-card__title/g)?.length).toBe(2);
  });
});
