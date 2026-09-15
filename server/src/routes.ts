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
import { readDashboard } from "./dashboard";
import { checkDirectory, listDirectories } from "./directories";
import { DEFAULT_LANGUAGE, LANGUAGES, LocalizedError, messages, type Language, type Messages, type TextKey } from "./i18n";
import type { MailService } from "./mailer";
import { buildTestEmail } from "./notifier";
import { createRoutine, deleteRoutine, getRun, listRoutines, listRuns, NotFoundError, updateRoutine, type RoutineInput } from "./routines";
import type { Scheduler } from "./scheduler";
import { getMeta, readSettings, writeSettings } from "./settings";

export class ValidationError extends LocalizedError {
  readonly details: unknown;

  constructor(key: TextKey, details?: unknown) {
    super(key);
    this.details = details;
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// O binario entra na linha de comando do cmd: sem aspas nem metacaracteres de shell.
const BIN_PATTERN = /^[^"&|<>^%!\r\n]+$/;
export const LOG_MAX_BYTES = 2 * 1024 * 1024;

function passwordFieldFor(m: Messages) {
  return z.string().min(MIN_PASSWORD_LENGTH, m.passwordTooShort(MIN_PASSWORD_LENGTH)).max(200);
}

/**
 * Um schema para os tres executores. Script: `command` obrigatorio, prompt/modelo/effort/fallback ignorados e
 * normalizados. Agente: prompt obrigatorio, effort e modelo da lista, `command` vazio. Intervalo vale para os dois.
 * As mensagens saem no idioma pedido; a regra e uma so.
 */
function buildRoutineSchema(m: Messages) {
  return z
    .object({
      name: z.string().trim().min(1, m.nameRequired).max(80),
      agentKind: z.enum(EXECUTOR_KINDS),
      directory: z.string().min(1, m.directoryRequired).max(1000),
      model: z.string().min(1).max(100).nullable(),
      effort: z.string().max(20),
      timeoutMinutes: z.number().int().min(1).max(TIMEOUT_CEILING_MINUTES),
      isFallbackEnabled: z.boolean(),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1, m.daysRequired)
        .max(7)
        .refine((days) => new Set(days).size === days.length, { message: m.daysRepeated }),
      time: z.string().regex(TIME_PATTERN, m.timeInvalid),
      intervalMinutes: z
        .number()
        .int()
        .nullable()
        .refine((value) => value === null || (INTERVAL_OPTIONS_MINUTES as readonly number[]).includes(value), {
          message: m.intervalInvalid
        }),
      prompt: z.string().max(20_000),
      command: z.string().max(COMMAND_MAX_CHARS, m.commandTooLong(COMMAND_MAX_CHARS)),
      missedPolicy: z.enum(["SKIP", "RUN_ON_BOOT"]),
      isEnabled: z.boolean()
    })
    .superRefine((value, ctx) => {
      if (value.agentKind === "SCRIPT") {
        if (!value.command.trim()) ctx.addIssue({ code: "custom", path: ["command"], message: m.commandRequired });
        if (/[\r\n]/.test(value.command)) ctx.addIssue({ code: "custom", path: ["command"], message: m.commandOneLine });
        if (value.model !== null) ctx.addIssue({ code: "custom", path: ["model"], message: m.scriptHasNoModel });
        return;
      }
      if (value.command.trim()) ctx.addIssue({ code: "custom", path: ["command"], message: m.onlyScriptHasCommand });
      if (!value.prompt.trim()) ctx.addIssue({ code: "custom", path: ["prompt"], message: m.promptRequired });
      if (!EFFORTS_BY_KIND[value.agentKind].includes(value.effort)) {
        ctx.addIssue({ code: "custom", path: ["effort"], message: m.effortUnknown });
      }
      if (value.model !== null && !MODELS_BY_KIND[value.agentKind].some((option) => option.value === value.model)) {
        ctx.addIssue({ code: "custom", path: ["model"], message: m.modelUnknown });
      }
    });
}

const ROUTINE_SCHEMAS = Object.fromEntries(LANGUAGES.map((language) => [language, buildRoutineSchema(messages(language))])) as Record<
  Language,
  ReturnType<typeof buildRoutineSchema>
>;

/** O schema em portugues, para o CLI, a importacao e os testes; as rotas pegam o do idioma do painel. */
export const routineSchema = ROUTINE_SCHEMAS[DEFAULT_LANGUAGE];

export function routineSchemaFor(language: Language) {
  return ROUTINE_SCHEMAS[language];
}

/** O que vai para o banco: script sem resquício de agente, agente sem comando. */
export function normalizeRoutine(input: z.infer<typeof routineSchema>): RoutineInput {
  if (!isAgentKind(input.agentKind)) {
    return { ...input, prompt: "", model: null, effort: "", isFallbackEnabled: false, command: input.command.trim() };
  }
  return { ...input, command: null };
}

function settingsSchemaFor(m: Messages) {
  const binField = z.string().trim().min(1).max(260).regex(BIN_PATTERN, m.binInvalid);
  return z.object({
    rootDirectory: z.string().max(1000),
    claudeBin: binField,
    codexBin: binField,
    maxParallel: z.number().int().min(1).max(10),
    bootDelayMinutes: z.number().int().min(0).max(120),
    // Opcional: o destinatario hoje e gravado pelo modal de e-mail (PUT /settings/mail); quem manda aqui ainda vale.
    notifyEmail: z.string().trim().pipe(z.union([z.literal(""), z.email(m.notifyEmailInvalid).max(254)])).optional(),
    // Opcional: o painel manda o idioma junto com o resto; quem nao manda nao muda o que esta salvo.
    language: z.enum(LANGUAGES, { error: m.languageInvalid }).optional()
  });
}

function changePasswordSchemaFor(m: Messages) {
  return z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordFieldFor(m) });
}

// Servidor SMTP: nome de host ou IP; IPv6 entre colchetes. Nada de espaco, barra ou porta grudada.
const HOST_PATTERN = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])$/;

/** Modal de e-mail: conta de envio (ou nula, para gravar so o destinatario) e quem recebe os avisos. */
function mailSchemaFor(m: Messages) {
  return z.object({
    account: z
      .object({
        host: z.string().trim().max(253).regex(HOST_PATTERN, m.mailHostInvalid),
        port: z.number({ error: m.mailPortInvalid }).int(m.mailPortInvalid).min(1, m.mailPortInvalid).max(65_535, m.mailPortInvalid),
        fromEmail: z.string().trim().pipe(z.email(m.mailFromInvalid).max(254)),
        // Vazia = manter a senha ja salva pelo painel.
        password: z.string().max(500)
      })
      .nullable(),
    notifyEmail: z.string().trim().pipe(z.email(m.notifyEmailInvalid).max(254))
  });
}

const languageSchema = z.object({ language: z.enum(LANGUAGES) });
const idSchema = z.coerce.number().int().positive();
const runsQuerySchema = z.object({
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError("invalidData", z.flattenError(result.error));
  return result.data;
}

function parseId(value: string | undefined): number {
  const result = idSchema.safeParse(value);
  if (!result.success) throw new NotFoundError("notFound");
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

function settingsPayload(db: Db, mailer: MailService, language: Language) {
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
    mail: mailer.describe(language)
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
    const m = messages(req.language);
    const { password } = parse(z.object({ password: passwordFieldFor(m) }), req.body);
    if (getPasswordHash(db) !== null || !setupPassword(db, password)) {
      res.status(409).json({ message: m.passwordAlreadySet });
      return;
    }
    setSessionCookie(res, createSession(db, now()));
    res.status(201).json({ isAuthenticated: true });
  });

  router.post("/login", (req, res) => {
    const waitMs = limiter.retryAfterMs();
    if (waitMs > 0) {
      res.setHeader("Retry-After", String(Math.ceil(waitMs / 1000)));
      res.status(429).json({ message: messages(req.language).tooManyAttempts });
      return;
    }
    const { password } = parse(z.object({ password: z.string().min(1).max(200) }), req.body);
    const stored = getPasswordHash(db);
    if (stored === null) {
      res.status(409).json({ message: messages(req.language).createPasswordFirst });
      return;
    }
    if (!verifyPassword(password, stored)) {
      limiter.recordFailure();
      res.status(401).json({ message: messages(req.language).wrongPassword });
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
  mailer: MailService;
  panelUrl: string;
  now: () => number;
}): Router {
  const router = Router();

  function parseRoutine(body: unknown, language: Language): RoutineInput {
    const input = normalizeRoutine(parse(routineSchemaFor(language), body));
    const directory = checkDirectory(readSettings(db).rootDirectory, input.directory);
    if (!directory.ok) throw new ValidationError(directory.reason, { fieldErrors: { directory: [messages(language)[directory.reason]] } });
    return { ...input, directory: directory.real };
  }

  function findRoutine(id: number, language: Language) {
    return listRoutines(db, now(), readSettings(db).rootDirectory, language).find((routine) => routine.id === id) ?? null;
  }

  router.post("/auth/logout", (req, res) => {
    deleteSession(db, readSessionToken(req));
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/settings", (req, res) => {
    res.json(settingsPayload(db, mailer, req.language));
  });

  router.put("/settings", (req, res) => {
    const input = parse(settingsSchemaFor(messages(req.language)), req.body);
    let rootDirectory = "";
    if (input.rootDirectory.trim()) {
      const root = checkDirectory(input.rootDirectory, input.rootDirectory);
      if (!root.ok) throw new ValidationError(root.reason, { fieldErrors: { rootDirectory: [messages(req.language)[root.reason]] } });
      rootDirectory = root.real;
    }
    writeSettings(db, { ...input, rootDirectory });
    res.json(settingsPayload(db, mailer, req.language));
  });

  // O seletor do painel grava so o idioma: e o que as notas de execucao e o e-mail de aviso usam.
  router.put("/settings/language", (req, res) => {
    const { language } = parse(languageSchema, req.body);
    writeSettings(db, { language });
    res.json({ language });
  });

  // Modal de e-mail. Com conta, a conexao e testada antes de gravar; a falha do SMTP vira 502 no handler de erro.
  router.put("/settings/mail", async (req, res) => {
    const m = messages(req.language);
    const { account, notifyEmail } = parse(mailSchemaFor(m), req.body);
    if (account && !account.password.trim() && mailer.describe().source !== "panel") {
      throw new ValidationError("mailPasswordRequired", { fieldErrors: { password: [m.mailPasswordRequired] } });
    }
    await mailer.save({
      account: account && { host: account.host, port: account.port, user: account.fromEmail, password: account.password, fromEmail: account.fromEmail },
      notifyEmail
    });
    res.json(settingsPayload(db, mailer, req.language));
  });

  router.delete("/settings/mail", (req, res) => {
    mailer.remove();
    res.json(settingsPayload(db, mailer, req.language));
  });

  // Manda o e-mail de teste para o destinatario ja salvo: e o mesmo caminho do aviso de falha, e atualiza o selo.
  router.post("/settings/notify-test", async (req, res) => {
    const { notifyEmail, language } = readSettings(db);
    if (!notifyEmail) throw new ValidationError("notifyEmailMissing");
    if (!mailer.isConfigured) throw new ValidationError("mailNotConfigured");
    await mailer.send({ to: notifyEmail, ...buildTestEmail(panelUrl, language) });
    res.json({ sentTo: notifyEmail });
  });

  router.put("/settings/password", (req, res) => {
    const { currentPassword, newPassword } = parse(changePasswordSchemaFor(messages(req.language)), req.body);
    const stored = getPasswordHash(db);
    if (stored === null || !verifyPassword(currentPassword, stored)) {
      throw new ValidationError("currentPasswordWrong", { fieldErrors: { currentPassword: [messages(req.language).currentPasswordWrong] } });
    }
    changePassword(db, newPassword);
    deleteOtherSessions(db, readSessionToken(req));
    res.status(204).end();
  });

  router.get("/settings/directories", (_req, res) => {
    const { rootDirectory } = readSettings(db);
    res.json({ rootDirectory, directories: listDirectories(rootDirectory) });
  });

  router.get("/routines", (req, res) => {
    res.json({ routines: listRoutines(db, now(), readSettings(db).rootDirectory, req.language) });
  });

  router.get("/dashboard", (req, res) => {
    const { hours } = parse(z.object({ hours: z.enum(["24", "168", "720"]).default("24") }), req.query);
    res.json(readDashboard(db, now(), Number(hours)));
  });

  router.post("/routines", (req, res) => {
    const id = createRoutine(db, parseRoutine(req.body, req.language), now());
    res.status(201).json({ routine: findRoutine(id, req.language) });
  });

  router.put("/routines/:id", (req, res) => {
    const id = parseId(req.params.id);
    updateRoutine(db, id, parseRoutine(req.body, req.language), now());
    res.json({ routine: findRoutine(id, req.language) });
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
    if (!run) throw new NotFoundError("runNotFound");
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
