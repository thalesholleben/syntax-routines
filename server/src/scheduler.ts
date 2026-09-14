import path from "node:path";

import { MAX_ATTEMPTS, normalizeEffort, otherAgent, type AgentKind, type ExecutorKind } from "./agents";
import { transaction, type Db } from "./db";
import { checkDirectory } from "./directories";
import { LOCALE, messages, type Language } from "./i18n";
import { LimitTracker } from "./limit-tracker";
import { log } from "./log";
import type { Mailer } from "./mailer";
import { buildFailureEmail } from "./notifier";
import { purgeOldRuns } from "./retention";
import { decideRetry } from "./retry-policy";
import { ConflictError, enqueueManualRun, getRoutine, getRun, NotFoundError, ROUTINE_COLUMNS, type RoutineRow } from "./routines";
import type { AgentRunHandle, AgentRunOutcome, RunAgent, RunScript } from "./runner";
import { occurrencesBetween, planWindow } from "./schedule";
import { getMeta, readSettings, setMeta, type Settings } from "./settings";

export const TICK_INTERVAL_MS = 30_000;
const LAST_TICK_KEY = "last_tick_at";
const LAST_PURGE_KEY = "last_purge_at";
const PURGE_INTERVAL_MS = 60 * 60_000;
const LIMIT_BUFFER_MS = 5 * 60_000;
const UNKNOWN_RESET_WAIT_MS = 60 * 60_000;
const RESULT_MAX_CHARS = 20_000;
const ERROR_MAX_CHARS = 8_000;
/** Falha com mais de 24 h nao gera aviso: cadastrar o e-mail depois nao pode disparar uma avalanche de historico. */
export const NOTIFY_WINDOW_MS = 24 * 60 * 60_000;
export const NOTIFY_MAX_ATTEMPTS = 3;
const DEFAULT_PANEL_URL = "http://127.0.0.1:4090/";

const REASON_KEY = { limit: "reasonLimit", transient: "reasonTransient", fatal: "reasonFatal" } as const;

// Acrescenta uma frase a nota da execucao sem apagar o que ja estava la.
const APPEND_NOTE = "CASE WHEN :note IS NULL THEN note WHEN note IS NULL THEN :note ELSE note || ' ' || :note END";

interface DueRun {
  id: number;
  routineId: number;
  forceAgent: AgentKind | null;
  attempt: number;
}

function clockText(ms: number, language: Language): string {
  return new Date(ms).toLocaleTimeString(LOCALE[language], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Claim atomico. As duas invariantes da fila (uma RUNNING por rotina e o teto global) ficam no proprio
 * UPDATE, que pega o lock de escrita antes de avaliar as condicoes: valem com qualquer numero de conexoes.
 */
export function claimRun(
  db: Db,
  params: { id: number; agent: ExecutorKind; now: number; maxParallel: number; note: string | null }
): boolean {
  const result = db
    .prepare(
      `UPDATE runs SET status = 'RUNNING', started_at = :now, finished_at = NULL, attempt = attempt + 1, agent_kind = :agent,
        note = ${APPEND_NOTE}
      WHERE id = :id AND status = 'QUEUED'
        AND NOT EXISTS (SELECT 1 FROM runs AS sibling WHERE sibling.routine_id = runs.routine_id AND sibling.status = 'RUNNING')
        AND (SELECT COUNT(*) FROM runs AS busy WHERE busy.status = 'RUNNING') < :maxParallel`
    )
    .run(params);
  return Number(result.changes) === 1;
}

export interface SchedulerDeps {
  db: Db;
  runAgent: RunAgent;
  runScript: RunScript;
  logsDir: string;
  now?: () => number;
  /** Envia os avisos de falha; sem mailer (ou sem destinatario em Ajustes) ninguem e avisado. */
  mailer?: Mailer;
  panelUrl?: string;
}

export function createScheduler({ db, runAgent, runScript, logsDir, now = Date.now, mailer, panelUrl = DEFAULT_PANEL_URL }: SchedulerDeps) {
  const limits = new LimitTracker(now);
  const running = new Map<number, AgentRunHandle>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let isStopped = false;
  let isNotifying = false;

  function countRunning(): number {
    const row = db.prepare(`SELECT COUNT(*) AS "count" FROM runs WHERE status = 'RUNNING'`).get() as { count: number };
    return row.count;
  }

  /** Materializa as ocorrencias desde o ultimo tick (regra de PC desligado inclusa) e despacha a fila. */
  function tick(): void {
    const nowMs = now();
    const { bootDelayMinutes, language } = readSettings(db);
    transaction(db, () => {
      const stored = getMeta(db, LAST_TICK_KEY);
      const lastTick = stored === null ? nowMs : Number(stored);
      const insert = db.prepare(
        `INSERT OR IGNORE INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, note, created_at)
        VALUES (:routineId, 'SCHEDULE', :scheduledFor, :runAt, :status, :note, :now)`
      );
      const routines = db.prepare(`SELECT ${ROUTINE_COLUMNS} FROM routines WHERE enabled = 1`).all() as unknown as RoutineRow[];
      for (const routine of routines) {
        // Horario que ja tinha passado quando a rotina foi salva nao dispara.
        const from = Math.max(lastTick, routine.updatedAt);
        const days = JSON.parse(routine.daysJson) as number[];
        const spec = { days, time: routine.time, intervalMinutes: routine.intervalMinutes };
        const occurrences = occurrencesBetween(spec, from, nowMs);
        const plans = planWindow(occurrences, nowMs, routine.missedPolicy, bootDelayMinutes * 60_000, undefined, {
          isInterval: routine.intervalMinutes !== null,
          language
        });
        for (const plan of plans) {
          insert.run({
            routineId: routine.id,
            scheduledFor: plan.scheduledFor,
            runAt: plan.runAt,
            status: plan.status,
            note: plan.note,
            now: nowMs
          });
        }
      }
      setMeta(db, LAST_TICK_KEY, String(nowMs));
    });
    dispatch();
    purgeIfDue(nowMs);
    void notifyFailures();
  }

  function purgeIfDue(nowMs: number): void {
    const last = getMeta(db, LAST_PURGE_KEY);
    if (last !== null && nowMs - Number(last) < PURGE_INTERVAL_MS) return;
    const removed = purgeOldRuns(db, logsDir, nowMs);
    setMeta(db, LAST_PURGE_KEY, String(nowMs));
    if (removed > 0) log(`retenção: ${removed} execução(ões) antiga(s) apagada(s)`);
  }

  function dispatch(): void {
    if (isStopped) return;
    const nowMs = now();
    const settings = readSettings(db);
    db.prepare(
      `UPDATE runs SET status = 'CANCELED', finished_at = :now, note = ${APPEND_NOTE}
      WHERE status = 'QUEUED' AND trigger_type = 'SCHEDULE' AND routine_id IN (SELECT id FROM routines WHERE enabled = 0)`
    ).run({ now: nowMs, note: messages(settings.language).noteDisabled });

    const due = db
      .prepare(
        `SELECT id, routine_id AS "routineId", force_agent AS "forceAgent", attempt FROM runs
        WHERE status = 'QUEUED' AND run_at <= :now ORDER BY run_at, id`
      )
      .all({ now: nowMs }) as unknown as DueRun[];
    for (const run of due) {
      if (countRunning() >= settings.maxParallel) break;
      startRun(run, settings, nowMs);
    }
  }

  function failBeforeStart(run: DueRun, routine: RoutineRow, nowMs: number, error: string): void {
    db.prepare(`UPDATE runs SET status = 'FAILED', finished_at = :now, error = :error WHERE id = :id AND status = 'QUEUED'`).run({
      now: nowMs,
      error,
      id: run.id
    });
    log(`execução ${run.id} (${routine.name}) não iniciada: ${error}`);
  }

  function watch(runId: number, handle: AgentRunHandle, onDone: (outcome: AgentRunOutcome) => void): void {
    running.set(runId, handle);
    void handle.done
      .catch(
        (error: unknown): AgentRunOutcome => ({
          code: null,
          result: "",
          stderrTail: "",
          isTimedOut: false,
          isKilled: false,
          spawnError: String(error)
        })
      )
      .then(onDone)
      .catch((error: unknown) => log(`[scheduler] falha ao finalizar a execução ${runId}: ${String(error)}`))
      .finally(() => {
        running.delete(runId);
        safeDispatch();
      });
  }

  function startRun(run: DueRun, settings: Settings, nowMs: number): void {
    const routine = getRoutine(db, run.routineId);
    if (!routine) return;

    // Revalida no despacho: a pasta mae pode ter mudado e a pasta pode ter virado junction desde que a rotina foi salva.
    const m = messages(settings.language);
    const directory = checkDirectory(settings.rootDirectory, routine.directory);
    if (!directory.ok) {
      failBeforeStart(run, routine, nowMs, m[directory.reason]);
      return;
    }

    if (routine.agentKind === "SCRIPT") {
      startScriptRun(run, routine, settings, nowMs, directory.real);
      return;
    }

    let agent: AgentKind = run.forceAgent ?? routine.agentKind;
    let note: string | null = null;
    if (limits.isOnLimit(agent)) {
      const other = otherAgent(agent);
      if (routine.isFallbackEnabled === 1 && !limits.isOnLimit(other)) {
        note = m.noteLimitSwitch(agent, other);
        agent = other;
      } else {
        const retryAt = (limits.getResetAt(agent)?.getTime() ?? nowMs + UNKNOWN_RESET_WAIT_MS) + LIMIT_BUFFER_MS;
        db.prepare(`UPDATE runs SET run_at = :retryAt, note = ${APPEND_NOTE} WHERE id = :id AND status = 'QUEUED'`).run({
          retryAt,
          note: m.noteLimitWait(agent, clockText(retryAt, settings.language)),
          id: run.id
        });
        return;
      }
    }

    if (!claimRun(db, { id: run.id, agent, now: nowMs, maxParallel: settings.maxParallel, note })) return;

    const attempt = run.attempt + 1;
    const isOriginalAgent = agent === routine.agentKind;
    const handle = runAgent({
      runId: run.id,
      agentKind: agent,
      bin: agent === "CLAUDE" ? settings.claudeBin : settings.codexBin,
      directory: directory.real,
      // O modelo escolhido pertence ao agente da rotina; no fallback vai o padrao do CLI do outro.
      model: isOriginalAgent ? routine.model : null,
      effort: normalizeEffort(agent, routine.effort),
      prompt: routine.prompt,
      timeoutMs: routine.timeoutMinutes * 60_000,
      logFile: path.join(logsDir, `${run.id}.log`),
      attempt
    });
    log(`execução ${run.id} (${routine.name}) iniciada com ${agent}, tentativa ${attempt}`);
    watch(run.id, handle, (outcome) => finishRun(run.id, routine, agent, attempt, outcome, settings.language));
  }

  /** Script: sem limite de uso, sem fallback e sem retry. O codigo de saida decide. */
  function startScriptRun(run: DueRun, routine: RoutineRow, settings: Settings, nowMs: number, directory: string): void {
    const command = routine.command?.trim() ?? "";
    if (!command) {
      failBeforeStart(run, routine, nowMs, messages(settings.language).errorScriptWithoutCommand);
      return;
    }
    if (!claimRun(db, { id: run.id, agent: "SCRIPT", now: nowMs, maxParallel: settings.maxParallel, note: null })) return;
    const handle = runScript({
      runId: run.id,
      command,
      directory,
      timeoutMs: routine.timeoutMinutes * 60_000,
      logFile: path.join(logsDir, `${run.id}.log`)
    });
    log(`execução ${run.id} (${routine.name}) iniciada como script`);
    watch(run.id, handle, (outcome) => finishScriptRun(run.id, routine, outcome, settings.language));
  }

  function finishScriptRun(runId: number, routine: RoutineRow, outcome: AgentRunOutcome, language: Language): void {
    // Cancelada pelo usuario: o status ja e CANCELED. App encerrando: a recuperacao da proxima subida resolve.
    if (outcome.isKilled && !outcome.isTimedOut) return;
    const nowMs = now();
    const m = messages(language);
    if (outcome.code === 0 && !outcome.isTimedOut) {
      db.prepare(
        `UPDATE runs SET status = 'SUCCEEDED', finished_at = :now, exit_code = 0, result = :result, error = NULL
        WHERE id = :id AND status = 'RUNNING'`
      ).run({ now: nowMs, result: outcome.result.slice(0, RESULT_MAX_CHARS), id: runId });
      log(`execução ${runId} (${routine.name}) concluída`);
      return;
    }
    const detail = outcome.isTimedOut
      ? `${m.errorTimeout(routine.timeoutMinutes)}\n${outcome.stderrTail}`
      : outcome.spawnError
        ? m.errorSpawnCommand(outcome.spawnError)
        : `${m.errorCommandExit(outcome.code)}\n${outcome.result.slice(0, 2000)}\n${outcome.stderrTail}`;
    db.prepare(
      `UPDATE runs SET status = 'FAILED', finished_at = :now, exit_code = :exitCode, result = :result, error = :error
      WHERE id = :id AND status = 'RUNNING'`
    ).run({ now: nowMs, exitCode: outcome.code, result: outcome.result.slice(0, RESULT_MAX_CHARS), error: detail.trim().slice(0, ERROR_MAX_CHARS), id: runId });
    log(`execução ${runId} (${routine.name}) falhou: código ${outcome.code ?? "nenhum"}`);
  }

  function finishRun(runId: number, routine: RoutineRow, agent: AgentKind, attempt: number, outcome: AgentRunOutcome, language: Language): void {
    // Cancelada pelo usuario: o status ja e CANCELED. App encerrando: a recuperacao da proxima subida resolve.
    if (outcome.isKilled && !outcome.isTimedOut) return;
    const nowMs = now();
    const m = messages(language);

    if (outcome.code === 0 && !outcome.isTimedOut) {
      db.prepare(
        `UPDATE runs SET status = 'SUCCEEDED', finished_at = :now, exit_code = 0, result = :result, error = NULL
        WHERE id = :id AND status = 'RUNNING'`
      ).run({ now: nowMs, result: outcome.result.slice(0, RESULT_MAX_CHARS), id: runId });
      log(`execução ${runId} (${routine.name}) concluída`);
      return;
    }

    const detail = outcome.isTimedOut
      ? `${m.errorTimeout(routine.timeoutMinutes)}\n${outcome.stderrTail}`
      : outcome.spawnError
        ? m.errorSpawnAgent(agent, outcome.spawnError)
        : `${m.errorAgentExit(agent, outcome.code)}\n${outcome.result.slice(0, 2000)}\n${outcome.stderrTail}`;
    const error = detail.trim().slice(0, ERROR_MAX_CHARS);
    const decision = decideRetry({ text: error, attemptCount: attempt, maxAttempts: MAX_ATTEMPTS, now: new Date(nowMs) });
    if (decision.reason === "limit") limits.recordLimit(agent, decision.rawResetAt ?? null);

    if (decision.status === "FAILED" || !decision.nextRetryAt) {
      db.prepare(
        `UPDATE runs SET status = 'FAILED', finished_at = :now, exit_code = :exitCode, error = :error
        WHERE id = :id AND status = 'RUNNING'`
      ).run({ now: nowMs, exitCode: outcome.code, error, id: runId });
      log(`execução ${runId} (${routine.name}) falhou: ${messages("pt")[REASON_KEY[decision.reason]]}`);
      return;
    }

    const other = otherAgent(agent);
    const isFallback = decision.reason === "limit" && routine.isFallbackEnabled === 1 && !limits.isOnLimit(other);
    const nextAgent = isFallback ? other : agent;
    const runAt = isFallback ? nowMs : decision.nextRetryAt.getTime();
    const note = isFallback ? m.noteLimitFallback(agent, other) : m.noteRetry(attempt, m[REASON_KEY[decision.reason]], clockText(runAt, language));
    db.prepare(
      `UPDATE runs SET status = 'QUEUED', run_at = :runAt, force_agent = :forceAgent, exit_code = :exitCode, error = :error,
        note = ${APPEND_NOTE}
      WHERE id = :id AND status = 'RUNNING'`
    ).run({ runAt, forceAgent: nextAgent === routine.agentKind ? null : nextAgent, exitCode: outcome.code, error, note, id: runId });
  }

  /**
   * Passe de aviso: toda FAILED recente ainda nao avisada vira um e-mail. Fica fora do finishRun de proposito, para
   * cobrir tambem a falha de diretorio no despacho e a interrupcao recuperada na subida, e para ter retry pelo tick.
   */
  async function notifyFailures(): Promise<number> {
    if (isNotifying || isStopped) return 0;
    const { notifyEmail, language } = readSettings(db);
    if (!mailer || !mailer.isConfigured || !notifyEmail) return 0;
    isNotifying = true;
    let sent = 0;
    try {
      const nowMs = now();
      const pending = db
        .prepare(
          `SELECT id FROM runs
          WHERE status = 'FAILED' AND notified_at IS NULL AND notify_attempts < :maxAttempts
            AND finished_at IS NOT NULL AND finished_at >= :since
            AND finished_at + notify_attempts * notify_attempts * 60000 <= :now
          ORDER BY finished_at, id`
        )
        .all({ maxAttempts: NOTIFY_MAX_ATTEMPTS, since: nowMs - NOTIFY_WINDOW_MS, now: nowMs }) as { id: number }[];
      for (const { id } of pending) {
        if (isStopped) break;
        const run = getRun(db, id);
        const routine = run ? getRoutine(db, run.routineId) : undefined;
        if (!run || !routine) continue;
        try {
          await mailer.send({ to: notifyEmail, ...buildFailureEmail({ run, routine, panelUrl, language }) });
          db.prepare("UPDATE runs SET notified_at = :now WHERE id = :id").run({ now: now(), id });
          sent += 1;
          log(`aviso de falha da execução ${id} (${routine.name}) enviado para ${notifyEmail}`);
        } catch (error) {
          db.prepare("UPDATE runs SET notify_attempts = notify_attempts + 1 WHERE id = :id").run({ id });
          log(`aviso de falha da execução ${id} não enviado: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      isNotifying = false;
    }
    return sent;
  }

  function runNow(routineId: number): number {
    const runId = enqueueManualRun(db, routineId, now(), readSettings(db).language);
    safeDispatch();
    return runId;
  }

  function cancel(runId: number): void {
    const result = db
      .prepare(
        `UPDATE runs SET status = 'CANCELED', finished_at = :now, note = ${APPEND_NOTE}
        WHERE id = :id AND status IN ('QUEUED', 'RUNNING')`
      )
      .run({ now: now(), note: messages(readSettings(db).language).noteCanceled, id: runId });
    if (Number(result.changes) === 0) {
      const exists = db.prepare("SELECT 1 AS found FROM runs WHERE id = :id").get({ id: runId });
      throw exists ? new ConflictError("runAlreadyFinished") : new NotFoundError("runNotFound");
    }
    running.get(runId)?.kill();
  }

  /** Execucoes que ficaram RUNNING de um processo anterior. So chamar depois de garantir a porta. */
  function recoverOnBoot(): number {
    const result = db
      .prepare(
        `UPDATE runs SET status = 'FAILED', finished_at = :now, error = :error
        WHERE status = 'RUNNING'`
      )
      .run({ now: now(), error: messages(readSettings(db).language).errorInterrupted });
    return Number(result.changes);
  }

  function safeTick(): void {
    try {
      tick();
    } catch (error) {
      log(`[scheduler] tick falhou: ${String(error)}`);
    }
  }

  function safeDispatch(): void {
    try {
      dispatch();
    } catch (error) {
      log(`[scheduler] despacho falhou: ${String(error)}`);
    }
  }

  return {
    limits,
    tick,
    dispatch,
    notifyFailures,
    runNow,
    cancel,
    recoverOnBoot,
    countRunning,
    start(): void {
      isStopped = false;
      safeTick();
      timer = setInterval(safeTick, TICK_INTERVAL_MS);
    },
    stop(): void {
      isStopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      for (const handle of running.values()) handle.kill();
    }
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
