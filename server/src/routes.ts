import { closeSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { Router } from "express";
import { z } from "zod";

import {
  COMMAND_MAX_CHARS,
  EFFORTS_BY_KIND,
  EXECUTOR_KINDS,
  INTERVAL_OPTIONS_MINUTES,
  isAgentKind,
  MODELS_BY_KIND,
  TIMEOUT_CEILING_MINUTES,
  TIMEOUT_DEFAULT_MINUTES,
  TIMEOUT_OPTIONS_MINUTES
} from "./agents";
import {
  changePassword,
  clearSessionCookie,
  createLoginLimiter,
  createSession,
  deleteOtherSessions,
  deleteSession,
  getPasswordHash,
  isValidSession,
  MIN_PASSWORD_LENGTH,
  readSessionToken,
  setSessionCookie,
  setupPassword,
  verifyPassword
} from "./auth";
import type { Db } from "./db";
import { checkDirectory, listDirectories } from "./directories";
import { MailError, type Mailer } from "./mailer";
import { buildTestEmail } from "./notifier";
import { createRoutine, deleteRoutine, getRun, listRoutines, listRuns, NotFoundError, updateRoutine, type RoutineInput } from "./routines";
import type { Scheduler } from "./scheduler";
import { getMeta, readSettings, writeSettings } from "./settings";

export class ValidationError extends Error {
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// O binario entra na linha de comando do cmd: sem aspas nem metacaracteres de shell.
const BIN_PATTERN = /^[^"&|<>^%!\r\n]+$/;
export const LOG_MAX_BYTES = 2 * 1024 * 1024;

const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `A senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(200);

/**
 * Um schema para os tres executores. Script: `command` obrigatorio, prompt/modelo/effort/fallback ignorados e
 * normalizados. Agente: prompt obrigatorio, effort e modelo da lista, `command` vazio. Intervalo vale para os dois.
 */
export const routineSchema = z
  .object({
    name: z.string().trim().min(1, "Dê um nome para a rotina.").max(80),
    agentKind: z.enum(EXECUTOR_KINDS),
    directory: z.string().min(1, "Escolha o diretório.").max(1000),
    model: z.string().min(1).max(100).nullable(),
    effort: z.string().max(20),
    timeoutMinutes: z.number().int().min(1).max(TIMEOUT_CEILING_MINUTES),
    isFallbackEnabled: z.boolean(),
    days: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Escolha pelo menos um dia.")
      .max(7)
      .refine((days) => new Set(days).size === days.length, { message: "Dias repetidos." }),
    time: z.string().regex(TIME_PATTERN, "Hora inválida: use HH:MM entre 00:00 e 23:59."),
    intervalMinutes: z
      .number()
      .int()
      .nullable()
      .refine((value) => value === null || (INTERVAL_OPTIONS_MINUTES as readonly number[]).includes(value), {
        message: "Intervalo fora da lista."
      }),
    prompt: z.string().max(20_000),
    command: z.string().max(COMMAND_MAX_CHARS, `O comando tem no máximo ${COMMAND_MAX_CHARS} caracteres.`),
    missedPolicy: z.enum(["SKIP", "RUN_ON_BOOT"]),
    isEnabled: z.boolean()
  })
  .superRefine((value, ctx) => {
    if (value.agentKind === "SCRIPT") {
      if (!value.command.trim()) ctx.addIssue({ code: "custom", path: ["command"], message: "Escreva o comando." });
      if (/[\r\n]/.test(value.command)) ctx.addIssue({ code: "custom", path: ["command"], message: "O comando é uma linha só." });
      if (value.model !== null) ctx.addIssue({ code: "custom", path: ["model"], message: "Script não tem modelo." });
      return;
    }
    if (value.command.trim()) ctx.addIssue({ code: "custom", path: ["command"], message: "Só rotina de script tem comando." });
    if (!value.prompt.trim()) ctx.addIssue({ code: "custom", path: ["prompt"], message: "Escreva o prompt." });
    if (!EFFORTS_BY_KIND[value.agentKind].includes(value.effort)) {
      ctx.addIssue({ code: "custom", path: ["effort"], message: "Esse effort não existe para o agente escolhido." });
    }
    if (value.model !== null && !MODELS_BY_KIND[value.agentKind].some((option) => option.value === value.model)) {
      ctx.addIssue({ code: "custom", path: ["model"], message: "Esse modelo não existe para o agente escolhido." });
    }
  });

/** O que vai para o banco: script sem resquício de agente, agente sem comando. */
export function normalizeRoutine(input: z.infer<typeof routineSchema>): RoutineInput {
  if (!isAgentKind(input.agentKind)) {
    return { ...input, prompt: "", model: null, effort: "", isFallbackEnabled: false, command: input.command.trim() };
  }
  return { ...input, command: null };
}

const binField = z.string().trim().min(1).max(260).regex(BIN_PATTERN, "Caminho do binário com caractere não permitido.");

const settingsSchema = z.object({
  rootDirectory: z.string().max(1000),
  claudeBin: binField,
  codexBin: binField,
  maxParallel: z.number().int().min(1).max(10),
  bootDelayMinutes: z.number().int().min(0).max(120),
  notifyEmail: z.string().trim().pipe(z.union([z.literal(""), z.email("E-mail de aviso inválido.").max(254)]))
});

const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordField });
const idSchema = z.coerce.number().int().positive();
const runsQuerySchema = z.object({
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("Dados inválidos.", z.flattenError(result.error));
  return result.data;
}

function parseId(value: string | undefined): number {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new NotFoundError("Não encontrado.");
  return result.data;
}

/** Log grande volta so com o final (ultimos 2 MB), sempre com o tamanho total e o aviso de que foi cortado. */
export function readLogTail(file: string): { log: string; logSize: number; isLogTruncated: boolean } {
  try {
    const { size } = statSync(file);
    const start = Math.max(0, size - LOG_MAX_BYTES);
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    return { log: buffer.toString("utf8"), logSize: size, isLogTruncated: start > 0 };
  } catch {
    return { log: "", logSize: 0, isLogTruncated: false };
  }
}

function settingsPayload(db: Db, mailer: Mailer) {
  return {
    settings: readSettings(db),
    agents: {
      models: MODELS_BY_KIND,
      efforts: EFFORTS_BY_KIND,
      timeoutOptions: TIMEOUT_OPTIONS_MINUTES,
      timeoutDefaultMinutes: TIMEOUT_DEFAULT_MINUTES,
      intervalOptions: INTERVAL_OPTIONS_MINUTES,
      commandMaxChars: COMMAND_MAX_CHARS
    },
    mail: { isConfigured: mailer.isConfigured, from: mailer.from }
  };
}

/** Unicas rotas sem sessao: estado, criacao da senha e login. */
export function createPublicRouter({ db, now }: { db: Db; now: () => number }): Router {
  const router = Router();
  const limiter = createLoginLimiter(now);

  router.get("/state", (req, res) => {
    res.json({ isSetupRequired: getPasswordHash(db) === null, isAuthenticated: isValidSession(db, readSessionToken(req), now()) });
  });

  router.post("/setup", (req, res) => {
    const { password } = parse(z.object({ password: passwordField }), req.body);
    if (getPasswordHash(db) !== null || !setupPassword(db, password)) {
      res.status(409).json({ message: "A senha já foi criada. Entre com ela." });
      return;
    }
    setSessionCookie(res, createSession(db, now()));
    res.status(201).json({ isAuthenticated: true });
  });

  router.post("/login", (req, res) => {
    const waitMs = limiter.retryAfterMs();
    if (waitMs > 0) {
      res.setHeader("Retry-After", String(Math.ceil(waitMs / 1000)));
      res.status(429).json({ message: "Muitas tentativas. Espere um minuto e tente de novo." });
      return;
    }
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const stored = getPasswordHash(db);
    if (stored === null) {
      res.status(409).json({ message: "Crie a senha primeiro." });
      return;
    }
    if (!verifyPassword(password, stored)) {
      limiter.recordFailure();
      res.status(401).json({ message: "Senha incorreta." });
      return;
    }
    limiter.reset();
    setSessionCookie(res, createSession(db, now()));
    res.json({ isAuthenticated: true });
  });

  return router;
}

/** Montado depois do requireAuth: tudo aqui ja tem sessao valida. */
export function createProtectedRouter({
  db,
  scheduler,
  logsDir,
  mailer,
  panelUrl,
  now
}: {
  db: Db;
  scheduler: Scheduler;
  logsDir: string;
  mailer: Mailer;
  panelUrl: string;
  now: () => number;
}): Router {
  const router = Router();

  function parseRoutine(body: unknown): RoutineInput {
    const input = normalizeRoutine(parse(routineSchema, body));
    const directory = checkDirectory(readSettings(db).rootDirectory, input.directory);
    if (!directory.ok) throw new ValidationError(directory.reason, { fieldErrors: { directory: [directory.reason] } });
    return { ...input, directory: directory.real };
  }

  function findRoutine(id: number) {
    return listRoutines(db, now(), readSettings(db).rootDirectory).find((routine) => routine.id === id) ?? null;
  }

  router.post("/auth/logout", (req, res) => {
    deleteSession(db, readSessionToken(req));
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/settings", (_req, res) => {
    res.json(settingsPayload(db, mailer));
  });

  router.put("/settings", (req, res) => {
    const input = parse(settingsSchema, req.body);
    let rootDirectory = "";
    if (input.rootDirectory.trim()) {
      const root = checkDirectory(input.rootDirectory, input.rootDirectory);
      if (!root.ok) throw new ValidationError(root.reason, { fieldErrors: { rootDirectory: [root.reason] } });
      rootDirectory = root.real;
    }
    writeSettings(db, { ...input, rootDirectory });
    res.json(settingsPayload(db, mailer));
  });

  // Manda o e-mail de teste para o destinatario ja salvo: e o mesmo caminho do aviso de falha.
  router.post("/settings/notify-test", async (_req, res) => {
    const { notifyEmail } = readSettings(db);
    if (!notifyEmail) throw new ValidationError("Cadastre e salve o e-mail de aviso antes de testar.");
    if (!mailer.isConfigured) {
      throw new ValidationError("SMTP não configurado neste PC: crie o arquivo .env a partir do .env.example e reinicie o app.");
    }
    try {
      await mailer.send({ to: notifyEmail, ...buildTestEmail(panelUrl) });
    } catch (error) {
      res.status(502).json({ message: error instanceof MailError ? error.message : "Falha ao enviar o e-mail." });
      return;
    }
    res.json({ sentTo: notifyEmail });
  });

  router.put("/settings/password", (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);
    const stored = getPasswordHash(db);
    if (stored === null || !verifyPassword(currentPassword, stored)) {
      throw new ValidationError("Senha atual incorreta.", { fieldErrors: { currentPassword: ["Senha atual incorreta."] } });
    }
    changePassword(db, newPassword);
    deleteOtherSessions(db, readSessionToken(req));
    res.status(204).end();
  });

  router.get("/settings/directories", (_req, res) => {
    const { rootDirectory } = readSettings(db);
    res.json({ rootDirectory, directories: listDirectories(rootDirectory) });
  });

  router.get("/routines", (_req, res) => {
    res.json({ routines: listRoutines(db, now(), readSettings(db).rootDirectory) });
  });

  router.post("/routines", (req, res) => {
    const id = createRoutine(db, parseRoutine(req.body), now());
    res.status(201).json({ routine: findRoutine(id) });
  });

  router.put("/routines/:id", (req, res) => {
    const id = parseId(req.params.id);
    updateRoutine(db, id, parseRoutine(req.body), now());
    res.json({ routine: findRoutine(id) });
  });

  router.delete("/routines/:id", (req, res) => {
    deleteRoutine(db, parseId(req.params.id));
    res.status(204).end();
  });

  router.post("/routines/:id/run-now", (req, res) => {
    const runId = scheduler.runNow(parseId(req.params.id));
    res.status(202).json({ runId });
  });

  router.get("/routines/:id/runs", (req, res) => {
    const routineId = parseId(req.params.id);
    const query = parse(runsQuerySchema, req.query);
    const runs = listRuns(db, routineId, query.beforeId ?? null, query.limit);
    res.json({ runs, nextBeforeId: runs.length === query.limit ? runs[runs.length - 1].id : null });
  });

  router.get("/runs/:id", (req, res) => {
    const run = getRun(db, parseId(req.params.id));
    if (!run) throw new NotFoundError("Execução não encontrada.");
    const logFile = path.join(logsDir, `${run.id}.log`);
    res.json({ run, logFile, ...readLogTail(logFile) });
  });

  router.post("/runs/:id/cancel", (req, res) => {
    scheduler.cancel(parseId(req.params.id));
    res.status(204).end();
  });

  router.get("/status", (_req, res) => {
    const lastTick = getMeta(db, "last_tick_at");
    res.json({
      now: now(),
      lastTickAt: lastTick === null ? null : Number(lastTick),
      runningCount: scheduler.countRunning(),
      limits: scheduler.limits.getStatus()
    });
  });

  return router;
}
