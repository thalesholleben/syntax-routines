import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "./app";
import { openDb, type Db } from "./db";
import { MailError, type Mailer, type MailMessage } from "./mailer";
import type { RunAgent, RunScript } from "./runner";
import { createScheduler } from "./scheduler";

interface HttpResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  cookie: string | null;
  headers: http.IncomingHttpHeaders;
}

const PASSWORD = "teste-teste";

let tmp = "";
let root = "";
let db: Db;
let server: http.Server;
let port = 0;
let clock = 0;
let runnerCalls = 0;
let scriptCalls = 0;
let sentMail: MailMessage[] = [];
let mailRejectDetail: string | null = null;
let isMailConfigured = true;

// Runner que nunca termina: basta saber que o agente foi (ou nao foi) disparado.
const fakeRunAgent: RunAgent = () => {
  runnerCalls += 1;
  return { done: new Promise(() => {}), kill: () => {} };
};
const fakeRunScript: RunScript = () => {
  scriptCalls += 1;
  return { done: new Promise(() => {}), kill: () => {} };
};
const fakeMailer: Mailer = {
  get isConfigured() {
    return isMailConfigured;
  },
  from: "avisos@example.com",
  async send(message) {
    if (message.to.endsWith("@recusa.example")) throw new MailError("smtpRejected", "550 caixa inexistente");
    if (mailRejectDetail !== null) throw new MailError("smtpRejected", mailRejectDetail);
    sentMail.push(message);
  }
};

beforeEach(async () => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-app-")));
  root = path.join(tmp, "root");
  mkdirSync(path.join(root, "projeto"), { recursive: true });
  mkdirSync(path.join(tmp, "root-old"));
  db = openDb(path.join(tmp, "app.db"));
  clock = new Date(2026, 8, 14, 10, 0, 0).getTime();
  runnerCalls = 0;
  scriptCalls = 0;
  sentMail = [];
  mailRejectDetail = null;
  isMailConfigured = true;
  const now = () => clock;
  const logsDir = path.join(tmp, "logs");
  const scheduler = createScheduler({ db, runAgent: fakeRunAgent, runScript: fakeRunScript, logsDir, now });
  server = http.createServer(createApp({ db, scheduler, logsDir, mailer: fakeMailer, panelUrl: "http://127.0.0.1:4090/", now }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function request(
  method: string,
  urlPath: string,
  options: { body?: unknown; cookie?: string | null; origin?: string | null; host?: string; language?: string } = {}
): Promise<HttpResult> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const origin = options.origin === undefined ? `http://127.0.0.1:${port}` : options.origin;
  const headers: http.OutgoingHttpHeaders = { host: options.host ?? `127.0.0.1:${port}` };
  if (origin !== null) headers.origin = origin;
  if (options.language) headers["accept-language"] = options.language;
  if (options.cookie) headers.cookie = options.cookie;
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        raw += chunk;
      });
      res.on("end", () => {
        const setCookie = res.headers["set-cookie"]?.[0] ?? null;
        resolve({
          status: res.statusCode ?? 0,
          body: raw ? JSON.parse(raw) : null,
          cookie: setCookie ? setCookie.split(";")[0] : null,
          headers: res.headers
        });
      });
    });
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

async function setupSession(): Promise<string> {
  const response = await request("POST", "/api/auth/setup", { body: { password: PASSWORD } });
  expect(response.status).toBe(201);
  return response.cookie as string;
}

function settingsBody(overrides: Record<string, unknown> = {}) {
  return { rootDirectory: root, claudeBin: "claude", codexBin: "codex", maxParallel: 2, bootDelayMinutes: 10, notifyEmail: "", ...overrides };
}

function routineBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Resumo Google Ads",
    agentKind: "CLAUDE",
    directory: path.join(root, "projeto"),
    model: "claude-opus-5",
    effort: "high",
    timeoutMinutes: 60,
    isFallbackEnabled: true,
    days: [1],
    time: "09:00",
    intervalMinutes: null,
    prompt: "faz o resumo semanal da conta",
    command: "",
    missedPolicy: "RUN_ON_BOOT",
    isEnabled: true,
    ...overrides
  };
}

function scriptBody(overrides: Record<string, unknown> = {}) {
  return routineBody({ name: "Fila do Instagram", agentKind: "SCRIPT", model: null, effort: "", prompt: "", command: "cmd /c echo oi", ...overrides });
}

async function sessionWithRoot(): Promise<string> {
  const cookie = await setupSession();
  expect((await request("PUT", "/api/settings", { cookie, body: settingsBody() })).status).toBe(200);
  return cookie;
}

const PROTECTED_ROUTES: [string, string][] = [
  ["POST", "/api/auth/logout"],
  ["GET", "/api/settings"],
  ["PUT", "/api/settings"],
  ["POST", "/api/settings/notify-test"],
  ["PUT", "/api/settings/password"],
  ["GET", "/api/settings/directories"],
  ["GET", "/api/routines"],
  ["POST", "/api/routines"],
  ["PUT", "/api/routines/1"],
  ["DELETE", "/api/routines/1"],
  ["POST", "/api/routines/1/run-now"],
  ["GET", "/api/routines/1/runs"],
  ["GET", "/api/runs/1"],
  ["POST", "/api/runs/1/cancel"],
  ["GET", "/api/status"],
  ["GET", "/api/rota-inexistente"]
];

describe("deny-by-default", () => {
  it.each(PROTECTED_ROUTES)("%s %s sem sessao responde 401", async (method, urlPath) => {
    await setupSession();
    const response = await request(method, urlPath, { body: method === "GET" ? undefined : {} });
    expect(response.status).toBe(401);
  });

  it("cookie inventado tambem responde 401 e nao dispara agente", async () => {
    await setupSession();
    const response = await request("POST", "/api/routines/1/run-now", { cookie: "sr_session=inventado" });
    expect(response.status).toBe(401);
    expect(runnerCalls).toBe(0);
  });
});

describe("rotas publicas", () => {
  it("state avisa que falta criar a senha", async () => {
    const response = await request("GET", "/api/auth/state");
    expect(response).toMatchObject({ status: 200, body: { isSetupRequired: true, isAuthenticated: false } });
  });

  it("setup cria a senha e a sessao; o segundo setup responde 409", async () => {
    const cookie = await setupSession();
    expect(cookie).toMatch(/^sr_session=/);
    expect((await request("GET", "/api/auth/state", { cookie })).body).toEqual({ isSetupRequired: false, isAuthenticated: true });
    expect((await request("POST", "/api/auth/setup", { body: { password: "outra-outra" } })).status).toBe(409);
  });

  it("cookie da sessao sai HttpOnly e SameSite=Strict", async () => {
    const response = await request("POST", "/api/auth/setup", { body: { password: PASSWORD } });
    const header = String(response.headers["set-cookie"]);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Strict");
  });

  it("dois setups disparados juntos: um 201 e um 409", async () => {
    const results = await Promise.all([
      request("POST", "/api/auth/setup", { body: { password: PASSWORD } }),
      request("POST", "/api/auth/setup", { body: { password: "outra-outra" } })
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it("senha curta no setup responde 400", async () => {
    expect((await request("POST", "/api/auth/setup", { body: { password: "curta" } })).status).toBe(400);
    expect((await request("GET", "/api/auth/state")).body.isSetupRequired).toBe(true);
  });

  it("5 senhas erradas bloqueiam o login por 60 s", async () => {
    await setupSession();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await request("POST", "/api/auth/login", { body: { password: "errada-errada" } })).status).toBe(401);
    }
    const blocked = await request("POST", "/api/auth/login", { body: { password: PASSWORD } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("60");

    clock += 60_000;
    const response = await request("POST", "/api/auth/login", { body: { password: PASSWORD } });
    expect(response.status).toBe(200);
    expect(response.cookie).toMatch(/^sr_session=/);
  });
});

describe("com sessao", () => {
  it("configura, cria, lista, edita, executa agora, cancela e exclui rotina", async () => {
    const cookie = await sessionWithRoot();
    expect((await request("GET", "/api/settings/directories", { cookie })).body.directories).toEqual([root, path.join(root, "projeto")]);

    const created = await request("POST", "/api/routines", { cookie, body: routineBody() });
    expect(created.status).toBe(201);
    expect(created.body.routine).toMatchObject({ name: "Resumo Google Ads", days: [1], isEnabled: true, directoryWarning: null });
    const id = created.body.routine.id as number;

    expect((await request("GET", "/api/routines", { cookie })).body.routines).toHaveLength(1);

    const updated = await request("PUT", `/api/routines/${id}`, { cookie, body: routineBody({ name: "Resumo semanal", time: "07:30" }) });
    expect(updated).toMatchObject({ status: 200, body: { routine: { name: "Resumo semanal", time: "07:30" } } });

    const run = await request("POST", `/api/routines/${id}/run-now`, { cookie });
    expect(run.status).toBe(202);
    expect(runnerCalls).toBe(1);
    expect((await request("POST", `/api/routines/${id}/run-now`, { cookie })).status).toBe(409);

    const runs = await request("GET", `/api/routines/${id}/runs`, { cookie });
    expect(runs.body.runs).toMatchObject([{ status: "RUNNING", triggerType: "MANUAL" }]);
    expect((await request("GET", `/api/runs/${run.body.runId}`, { cookie })).body.run).toMatchObject({ status: "RUNNING" });
    expect((await request("GET", "/api/status", { cookie })).body).toMatchObject({ runningCount: 1 });

    expect((await request("DELETE", `/api/routines/${id}`, { cookie })).status).toBe(409);
    expect((await request("POST", `/api/runs/${run.body.runId}/cancel`, { cookie })).status).toBe(204);
    expect((await request("DELETE", `/api/routines/${id}`, { cookie })).status).toBe(204);
    expect((await request("GET", "/api/routines", { cookie })).body.routines).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["hora 24:00", { time: "24:00" }],
    ["hora 99:99", { time: "99:99" }],
    ["hora 12:60", { time: "12:60" }],
    ["hora 9:00", { time: "9:00" }],
    ["hora abc", { time: "abc" }],
    ["dias vazios", { days: [] }],
    ["dias repetidos", { days: [1, 1] }],
    ["dia 7", { days: [7] }],
    ["effort de outro agente", { agentKind: "CODEX", model: null, effort: "max" }],
    ["modelo de outro agente", { model: "gpt-5.6-sol" }],
    ["timeout 0", { timeoutMinutes: 0 }],
    ["timeout 241", { timeoutMinutes: 241 }],
    ["prompt em branco", { prompt: "   " }],
    ["agente com comando", { command: "cmd /c dir" }],
    ["intervalo fora da lista", { intervalMinutes: 7 }],
    ["intervalo zero", { intervalMinutes: 0 }]
  ])("payload invalido (%s) responde 400 sem gravar", async (_label, overrides) => {
    const cookie = await sessionWithRoot();
    expect((await request("POST", "/api/routines", { cookie, body: routineBody(overrides) })).status).toBe(400);
    expect((await request("GET", "/api/routines", { cookie })).body.routines).toHaveLength(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["comando em branco", { command: "   " }],
    ["comando com quebra de linha", { command: "cmd /c echo a\ncmd /c echo b" }],
    ["comando comprido demais", { command: "x".repeat(2001) }],
    ["script com modelo", { model: "claude-opus-5" }]
  ])("script invalido (%s) responde 400 sem gravar", async (_label, overrides) => {
    const cookie = await sessionWithRoot();
    expect((await request("POST", "/api/routines", { cookie, body: scriptBody(overrides) })).status).toBe(400);
    expect((await request("GET", "/api/routines", { cookie })).body.routines).toHaveLength(0);
  });

  it("script e gravado normalizado (sem modelo, effort, prompt ou fallback) e roda pelo runner de script", async () => {
    const cookie = await sessionWithRoot();
    const created = await request("POST", "/api/routines", {
      cookie,
      body: scriptBody({ effort: "high", prompt: "ignorado", isFallbackEnabled: true, command: "  cmd /c echo oi  ", intervalMinutes: 15 })
    });
    expect(created.status).toBe(201);
    expect(created.body.routine).toMatchObject({
      agentKind: "SCRIPT",
      command: "cmd /c echo oi",
      prompt: "",
      model: null,
      effort: "",
      isFallbackEnabled: false,
      intervalMinutes: 15
    });
    expect(created.body.routine.nextRunAt).toBe(new Date(2026, 8, 14, 10, 15).getTime());
    expect((await request("POST", `/api/routines/${created.body.routine.id}/run-now`, { cookie })).status).toBe(202);
    expect(scriptCalls).toBe(1);
    expect(runnerCalls).toBe(0);
  });

  it("e-mail de aviso: valida, salva, testa e devolve o estado do SMTP", async () => {
    const cookie = await setupSession();
    expect((await request("PUT", "/api/settings", { cookie, body: settingsBody({ notifyEmail: "nao-e-email" }) })).status).toBe(400);

    const semDestino = await request("POST", "/api/settings/notify-test", { cookie });
    expect(semDestino.status).toBe(400);
    expect(semDestino.body.message).toMatch(/Cadastre/);

    const saved = await request("PUT", "/api/settings", { cookie, body: settingsBody({ notifyEmail: "  dono@example.com " }) });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.notifyEmail).toBe("dono@example.com");
    expect(saved.body.mail).toEqual({ isConfigured: true, from: "avisos@example.com" });

    const ok = await request("POST", "/api/settings/notify-test", { cookie });
    expect(ok).toMatchObject({ status: 200, body: { sentTo: "dono@example.com" } });
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]).toMatchObject({ to: "dono@example.com", subject: "[Syntax Routines] E-mail de teste" });

    await request("PUT", "/api/settings", { cookie, body: settingsBody({ notifyEmail: "alguem@recusa.example" }) });
    const recusado = await request("POST", "/api/settings/notify-test", { cookie });
    expect(recusado.status).toBe(502);
    expect(recusado.body.message).toMatch(/SMTP/);

    isMailConfigured = false;
    const semSmtp = await request("POST", "/api/settings/notify-test", { cookie });
    expect(semSmtp.status).toBe(400);
    expect(semSmtp.body.message).toMatch(/não configurado/);
    expect((await request("GET", "/api/settings", { cookie })).body.mail.isConfigured).toBe(false);
  });

  it("diretorio irmao por prefixo responde 400 sem gravar", async () => {
    const cookie = await sessionWithRoot();
    const response = await request("POST", "/api/routines", { cookie, body: routineBody({ directory: path.join(tmp, "root-old") }) });
    expect(response).toMatchObject({ status: 400, body: { message: "Diretório fora da pasta mãe." } });
    expect((await request("GET", "/api/routines", { cookie })).body.routines).toHaveLength(0);
  });

  it("ajustes rejeitam pasta mae inexistente, pasta do sistema e binario com metacaractere", async () => {
    const cookie = await setupSession();
    expect((await request("PUT", "/api/settings", { cookie, body: settingsBody({ rootDirectory: path.join(tmp, "nao-existe") }) })).status).toBe(400);
    expect((await request("PUT", "/api/settings", { cookie, body: settingsBody({ rootDirectory: "C:\\Windows" }) })).status).toBe(400);
    expect((await request("PUT", "/api/settings", { cookie, body: settingsBody({ claudeBin: "claude & calc" }) })).status).toBe(400);
  });
});

describe("idioma", () => {
  it("Accept-Language decide a mensagem da API; sem cabecalho e portugues", async () => {
    const cookie = await sessionWithRoot();
    const inPortuguese = await request("POST", "/api/routines", { cookie, body: routineBody({ name: "  " }) });
    expect(inPortuguese.status).toBe(400);
    expect(inPortuguese.body).toMatchObject({ message: "Dados inválidos.", details: { fieldErrors: { name: ["Dê um nome para a rotina."] } } });

    const inEnglish = await request("POST", "/api/routines", { cookie, body: routineBody({ name: "  " }), language: "en-US,en;q=0.9" });
    expect(inEnglish.status).toBe(400);
    expect(inEnglish.body).toMatchObject({ message: "Invalid data.", details: { fieldErrors: { name: ["Give the routine a name."] } } });

    const outside = await request("POST", "/api/routines", { cookie, body: routineBody({ directory: tmp }), language: "en" });
    expect(outside.body).toMatchObject({ details: { fieldErrors: { directory: ["Directory outside the root folder."] } } });

    const login = await request("POST", "/api/auth/login", { body: { password: "errada-errada" }, language: "en" });
    expect(login.status).toBe(401);
    expect(login.body).toEqual({ message: "Wrong password." });

    const missing = await request("GET", "/api/runs/999", { cookie, language: "en" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ message: "Run not found." });
  });

  it("o idioma de Ajustes vale para as notas gravadas e para o e-mail; o seletor grava so ele", async () => {
    const cookie = await sessionWithRoot();
    expect((await request("GET", "/api/settings", { cookie })).body).toMatchObject({ settings: { language: "pt" } });

    const switched = await request("PUT", "/api/settings/language", { cookie, body: { language: "en" } });
    expect(switched.status).toBe(200);
    expect((await request("GET", "/api/settings", { cookie })).body).toMatchObject({ settings: { language: "en", rootDirectory: root } });
    expect((await request("PUT", "/api/settings/language", { cookie, body: { language: "xx" } })).status).toBe(400);

    const created = await request("POST", "/api/routines", { cookie, body: routineBody() });
    const id = (created.body as { routine: { id: number } }).routine.id;
    expect((await request("POST", `/api/routines/${id}/run-now`, { cookie })).status).toBe(202);
    const runs = (await request("GET", `/api/routines/${id}/runs`, { cookie })).body as { runs: { note: string }[] };
    expect(runs.runs[0].note).toBe("Manual run.");

    expect((await request("PUT", "/api/settings", { cookie, body: { ...settingsBody(), notifyEmail: "dono@example.com" } })).status).toBe(200);
    expect((await request("POST", "/api/settings/notify-test", { cookie })).status).toBe(200);
    expect(sentMail[0]).toMatchObject({ to: "dono@example.com", subject: "[Syntax Routines] Test e-mail" });
    // O PUT de ajustes sem `language` nao mexe no idioma salvo.
    expect((await request("GET", "/api/settings", { cookie })).body).toMatchObject({ settings: { language: "en" } });

    // SMTP recusando: a falha chega ao painel no idioma pedido, com o detalhe ja sanitizado pelo mailer.
    mailRejectDetail = "Invalid login: 535 AUTH [redacted]";
    const rejected = await request("POST", "/api/settings/notify-test", { cookie, language: "en" });
    expect(rejected.status).toBe(502);
    expect(rejected.body).toEqual({ message: "SMTP rejected the message: Invalid login: 535 AUTH [redacted]" });
    const rejectedPt = await request("POST", "/api/settings/notify-test", { cookie });
    expect(rejectedPt.body).toEqual({ message: "SMTP recusou o envio: Invalid login: 535 AUTH [redacted]" });
  });
});

describe("Origin", () => {
  async function routineAndSession() {
    const cookie = await sessionWithRoot();
    const created = await request("POST", "/api/routines", { cookie, body: routineBody() });
    return { cookie, id: created.body.routine.id as number };
  }

  it.each<[string, string | null]>([
    ["de outro site", "http://evil.example"],
    ["ausente", null],
    ["de outra porta local", "http://127.0.0.1:5180"],
    ["do Vite sem --dev", "http://127.0.0.1:5190"]
  ])("POST com Origin %s responde 403 e nao dispara agente", async (_label, origin) => {
    const { cookie, id } = await routineAndSession();
    expect((await request("POST", `/api/routines/${id}/run-now`, { cookie, origin })).status).toBe(403);
    expect(runnerCalls).toBe(0);
  });

  it("GET com Origin estranho responde 403", async () => {
    const cookie = await setupSession();
    expect((await request("GET", "/api/routines", { cookie, origin: "http://evil.example" })).status).toBe(403);
  });
});

describe("Host", () => {
  it.each<[string, string]>([
    ["GET", "/api/auth/state"],
    ["POST", "/api/auth/setup"],
    ["GET", "/api/routines"]
  ])("Host estranho em %s %s responde 403", async (method, urlPath) => {
    const response = await request(method, urlPath, {
      host: `evil.example:${port}`,
      body: method === "POST" ? { password: PASSWORD } : undefined
    });
    expect(response.status).toBe(403);
    expect((await request("GET", "/api/auth/state")).body.isSetupRequired).toBe(true);
  });
});

describe("sessao", () => {
  it("logout invalida o cookie", async () => {
    const cookie = await setupSession();
    expect((await request("POST", "/api/auth/logout", { cookie })).status).toBe(204);
    expect((await request("GET", "/api/routines", { cookie })).status).toBe(401);
  });

  it("troca de senha exige a atual e derruba as outras sessoes", async () => {
    const cookie = await setupSession();
    const other = (await request("POST", "/api/auth/login", { body: { password: PASSWORD } })).cookie as string;

    const wrong = await request("PUT", "/api/settings/password", { cookie, body: { currentPassword: "errada-errada", newPassword: "nova-senha-123" } });
    expect(wrong.status).toBe(400);
    const changed = await request("PUT", "/api/settings/password", { cookie, body: { currentPassword: PASSWORD, newPassword: "nova-senha-123" } });
    expect(changed.status).toBe(204);

    expect((await request("GET", "/api/routines", { cookie })).status).toBe(200);
    expect((await request("GET", "/api/routines", { cookie: other })).status).toBe(401);
    expect((await request("POST", "/api/auth/login", { body: { password: "nova-senha-123" } })).status).toBe(200);
  });
});

describe("entrada malformada e log grande", () => {
  it("cookie malformado conta como sessao ausente, sem erro 500", async () => {
    await setupSession();
    expect(await request("GET", "/api/auth/state", { cookie: "sr_session=%" })).toMatchObject({
      status: 200,
      body: { isSetupRequired: false, isAuthenticated: false }
    });
    expect((await request("GET", "/api/routines", { cookie: "sr_session=%" })).status).toBe(401);
  });

  it("log maior que 2 MB volta com o final, o tamanho total e o aviso de truncado", async () => {
    const cookie = await sessionWithRoot();
    const created = await request("POST", "/api/routines", { cookie, body: routineBody() });
    const run = await request("POST", `/api/routines/${created.body.routine.id}/run-now`, { cookie });
    const logFile = path.join(tmp, "logs", `${run.body.runId}.log`);
    mkdirSync(path.dirname(logFile), { recursive: true });
    const content = `COMECO\n${"x".repeat(2 * 1024 * 1024)}\nFIM`;
    writeFileSync(logFile, content);

    const detail = await request("GET", `/api/runs/${run.body.runId}`, { cookie });
    expect(detail.body).toMatchObject({ logFile, logSize: Buffer.byteLength(content), isLogTruncated: true });
    expect(Buffer.byteLength(detail.body.log)).toBe(2 * 1024 * 1024);
    expect(detail.body.log.endsWith("FIM")).toBe(true);
    expect(detail.body.log.includes("COMECO")).toBe(false);
  });

  it("log pequeno volta inteiro e sem aviso de truncado", async () => {
    const cookie = await sessionWithRoot();
    const created = await request("POST", "/api/routines", { cookie, body: routineBody() });
    const run = await request("POST", `/api/routines/${created.body.routine.id}/run-now`, { cookie });
    const logFile = path.join(tmp, "logs", `${run.body.runId}.log`);
    mkdirSync(path.dirname(logFile), { recursive: true });
    writeFileSync(logFile, "linha 1\nlinha 2");

    expect((await request("GET", `/api/runs/${run.body.runId}`, { cookie })).body).toMatchObject({
      log: "linha 1\nlinha 2",
      logSize: 15,
      isLogTruncated: false
    });
  });
});
