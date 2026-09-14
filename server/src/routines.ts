import type { AgentKind, ExecutorKind } from "./agents";
import { transaction, type Db } from "./db";
import { checkDirectory } from "./directories";
import { nextOccurrence, type MissedPolicy } from "./schedule";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "CANCELED";
export type TriggerType = "SCHEDULE" | "MANUAL";

export interface RoutineInput {
  name: string;
  agentKind: ExecutorKind;
  directory: string;
  model: string | null;
  effort: string;
  timeoutMinutes: number;
  isFallbackEnabled: boolean;
  days: number[];
  time: string;
  /** "A cada N minutos" nos dias marcados; nulo = hora fixa em `time`. */
  intervalMinutes: number | null;
  prompt: string;
  /** Linha de comando da rotina de script; nulo nos agentes. */
  command: string | null;
  missedPolicy: MissedPolicy;
  isEnabled: boolean;
}

/** Linha de `routines` com alias camelCase; booleanos ainda em 0/1. */
export interface RoutineRow {
  id: number;
  name: string;
  agentKind: ExecutorKind;
  directory: string;
  model: string | null;
  effort: string;
  timeoutMinutes: number;
  isFallbackEnabled: number;
  daysJson: string;
  time: string;
  intervalMinutes: number | null;
  prompt: string;
  command: string | null;
  missedPolicy: MissedPolicy;
  isEnabled: number;
  createdAt: number;
  updatedAt: number;
}

export interface RunRow {
  id: number;
  routineId: number;
  triggerType: TriggerType;
  scheduledFor: number;
  runAt: number | null;
  status: RunStatus;
  forceAgent: AgentKind | null;
  agentKind: ExecutorKind | null;
  attempt: number;
  startedAt: number | null;
  finishedAt: number | null;
  exitCode: number | null;
  result: string | null;
  error: string | null;
  note: string | null;
  notifiedAt: number | null;
  notifyAttempts: number;
  createdAt: number;
}

export interface RoutineView extends Omit<RoutineRow, "isFallbackEnabled" | "isEnabled" | "daysJson"> {
  isFallbackEnabled: boolean;
  isEnabled: boolean;
  days: number[];
  nextRunAt: number | null;
  lastRun: RunRow | null;
  activeRun: RunRow | null;
  directoryWarning: string | null;
}

export const ROUTINE_COLUMNS = `id, name, agent_kind AS "agentKind", directory, model, effort,
  timeout_minutes AS "timeoutMinutes", fallback_enabled AS "isFallbackEnabled", days_json AS "daysJson", time,
  interval_minutes AS "intervalMinutes", prompt, command, missed_policy AS "missedPolicy", enabled AS "isEnabled",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export const RUN_COLUMNS = `id, routine_id AS "routineId", trigger_type AS "triggerType", scheduled_for AS "scheduledFor",
  run_at AS "runAt", status, force_agent AS "forceAgent", agent_kind AS "agentKind", attempt, started_at AS "startedAt",
  finished_at AS "finishedAt", exit_code AS "exitCode", result, error, note, notified_at AS "notifiedAt",
  notify_attempts AS "notifyAttempts", created_at AS "createdAt"`;

function toParams(input: RoutineInput, nowMs: number) {
  return {
    name: input.name,
    agentKind: input.agentKind,
    directory: input.directory,
    model: input.model,
    effort: input.effort,
    timeoutMinutes: input.timeoutMinutes,
    fallbackEnabled: input.isFallbackEnabled ? 1 : 0,
    daysJson: JSON.stringify([...new Set(input.days)].sort((a, b) => a - b)),
    time: input.time,
    intervalMinutes: input.intervalMinutes,
    prompt: input.prompt,
    command: input.command,
    missedPolicy: input.missedPolicy,
    enabled: input.isEnabled ? 1 : 0,
    now: nowMs
  };
}

export function createRoutine(db: Db, input: RoutineInput, nowMs: number): number {
  const result = db
    .prepare(
      `INSERT INTO routines (name, agent_kind, directory, model, effort, timeout_minutes, fallback_enabled, days_json, time,
        interval_minutes, prompt, command, missed_policy, enabled, created_at, updated_at)
      VALUES (:name, :agentKind, :directory, :model, :effort, :timeoutMinutes, :fallbackEnabled, :daysJson, :time,
        :intervalMinutes, :prompt, :command, :missedPolicy, :enabled, :now, :now)`
    )
    .run(toParams(input, nowMs));
  return Number(result.lastInsertRowid);
}

export function updateRoutine(db: Db, id: number, input: RoutineInput, nowMs: number): void {
  const result = db
    .prepare(
      `UPDATE routines SET name = :name, agent_kind = :agentKind, directory = :directory, model = :model, effort = :effort,
        timeout_minutes = :timeoutMinutes, fallback_enabled = :fallbackEnabled, days_json = :daysJson, time = :time,
        interval_minutes = :intervalMinutes, prompt = :prompt, command = :command, missed_policy = :missedPolicy,
        enabled = :enabled, updated_at = :now
      WHERE id = :id`
    )
    .run({ ...toParams(input, nowMs), id });
  if (Number(result.changes) === 0) throw new NotFoundError("Rotina não encontrada.");
}

export function getRoutine(db: Db, id: number): RoutineRow | undefined {
  return db.prepare(`SELECT ${ROUTINE_COLUMNS} FROM routines WHERE id = :id`).get({ id }) as unknown as RoutineRow | undefined;
}

export function hasActiveRun(db: Db, routineId: number): boolean {
  const row = db
    .prepare("SELECT 1 AS found FROM runs WHERE routine_id = :routineId AND status IN ('QUEUED', 'RUNNING') LIMIT 1")
    .get({ routineId });
  return row !== undefined;
}

export function deleteRoutine(db: Db, id: number): void {
  transaction(db, () => {
    if (!getRoutine(db, id)) throw new NotFoundError("Rotina não encontrada.");
    if (hasActiveRun(db, id)) throw new ConflictError("Cancele a execução na fila ou rodando antes de excluir a rotina.");
    db.prepare("DELETE FROM routines WHERE id = :id").run({ id });
  });
}

export function toRoutineFields(row: RoutineRow): Omit<RoutineView, "nextRunAt" | "lastRun" | "activeRun" | "directoryWarning"> {
  const { daysJson, isFallbackEnabled, isEnabled, ...rest } = row;
  return { ...rest, days: JSON.parse(daysJson) as number[], isFallbackEnabled: isFallbackEnabled === 1, isEnabled: isEnabled === 1 };
}

export function listRoutines(db: Db, nowMs: number, rootDirectory: string): RoutineView[] {
  const rows = db.prepare(`SELECT ${ROUTINE_COLUMNS} FROM routines ORDER BY name COLLATE NOCASE, id`).all() as unknown as RoutineRow[];
  const lastRun = db.prepare(
    `SELECT ${RUN_COLUMNS} FROM runs WHERE routine_id = :routineId AND status NOT IN ('QUEUED', 'RUNNING')
    ORDER BY COALESCE(finished_at, created_at) DESC, id DESC LIMIT 1`
  );
  const activeRun = db.prepare(
    `SELECT ${RUN_COLUMNS} FROM runs WHERE routine_id = :routineId AND status IN ('QUEUED', 'RUNNING') ORDER BY id LIMIT 1`
  );
  return rows.map((row) => {
    const fields = toRoutineFields(row);
    const directory = checkDirectory(rootDirectory, row.directory);
    return {
      ...fields,
      nextRunAt: fields.isEnabled ? nextOccurrence({ days: fields.days, time: fields.time, intervalMinutes: fields.intervalMinutes }, nowMs) : null,
      lastRun: (lastRun.get({ routineId: row.id }) as unknown as RunRow | undefined) ?? null,
      activeRun: (activeRun.get({ routineId: row.id }) as unknown as RunRow | undefined) ?? null,
      directoryWarning: directory.ok ? null : directory.reason
    };
  });
}

/**
 * Poe uma execucao manual na fila. Mesmas invariantes do botao "Executar agora" do painel, num caminho so:
 * o agendador do app e o CLI chamam esta funcao. Quem despacha continua sendo o agendador.
 */
export function enqueueManualRun(db: Db, routineId: number, nowMs: number): number {
  return transaction(db, () => {
    if (!getRoutine(db, routineId)) throw new NotFoundError("Rotina não encontrada.");
    if (hasActiveRun(db, routineId)) throw new ConflictError("Esta rotina já tem uma execução na fila ou rodando.");
    const result = db
      .prepare(
        `INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, note, created_at)
        VALUES (:routineId, 'MANUAL', :now, :now, 'QUEUED', 'Execução manual.', :now)`
      )
      .run({ routineId, now: nowMs });
    return Number(result.lastInsertRowid);
  });
}

/** Historico da rotina, mais recente primeiro, paginado por id (`beforeId`). */
export function listRuns(db: Db, routineId: number, beforeId: number | null, limit: number): RunRow[] {
  return db
    .prepare(
      `SELECT ${RUN_COLUMNS} FROM runs WHERE routine_id = :routineId AND (:beforeId IS NULL OR id < :beforeId)
      ORDER BY id DESC LIMIT :limit`
    )
    .all({ routineId, beforeId, limit }) as unknown as RunRow[];
}

export function getRun(db: Db, id: number): RunRow | undefined {
  return db.prepare(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = :id`).get({ id }) as unknown as RunRow | undefined;
}
