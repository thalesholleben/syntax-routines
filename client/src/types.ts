export type AgentKind = "CLAUDE" | "CODEX";
/** Quem executa: um dos agentes ou um script (comando direto). */
export type ExecutorKind = AgentKind | "SCRIPT";
export type MissedPolicy = "SKIP" | "RUN_ON_BOOT";
export type RunStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "CANCELED";

export interface RunDto {
  id: number;
  routineId: number;
  triggerType: "SCHEDULE" | "MANUAL";
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

export interface RoutinePayload {
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
  /** Comando da rotina de script; vazio nos agentes. */
  command: string;
  missedPolicy: MissedPolicy;
  isEnabled: boolean;
}

export interface RoutineDto extends Omit<RoutinePayload, "command"> {
  id: number;
  command: string | null;
  createdAt: number;
  updatedAt: number;
  nextRunAt: number | null;
  lastRun: RunDto | null;
  activeRun: RunDto | null;
  directoryWarning: string | null;
}

export interface SettingsDto {
  rootDirectory: string;
  claudeBin: string;
  codexBin: string;
  maxParallel: number;
  bootDelayMinutes: number;
  notifyEmail: string;
  language: "pt" | "en";
}

export interface AgentsMeta {
  models: Record<AgentKind, { value: string; label: string }[]>;
  efforts: Record<AgentKind, string[]>;
  timeoutOptions: number[];
  timeoutDefaultMinutes: number;
  intervalOptions: number[];
  commandMaxChars: number;
}

export type MailFailure = "notConfigured" | "auth" | "connection" | "notFound" | "tls" | "rejected" | "secret" | "other";

/** Conta que envia os avisos, como o servidor mostra: sem senha, nem cifrada. */
export interface MailMeta {
  isConfigured: boolean;
  source: "panel" | "env" | null;
  host: string;
  port: number;
  user: string;
  fromEmail: string;
  status: {
    state: "ok" | "failed" | "untested";
    at: number | null;
    reason: MailFailure | null;
    message: string | null;
    detail: string | null;
  };
}

/** Sistema do PC onde o app roda; escolhe o exemplo de comando e o texto do cofre de senha. */
export type Platform = "win32" | "darwin" | "linux" | "other";

export interface SettingsResponse {
  platform: Platform;
  settings: SettingsDto;
  agents: AgentsMeta;
  mail: MailMeta;
}

export interface AuthState {
  isSetupRequired: boolean;
  isAuthenticated: boolean;
}

export interface StatusDto {
  now: number;
  lastTickAt: number | null;
  runningCount: number;
  limits: Record<AgentKind, { isOnLimit: boolean; resetAt: string | null }>;
}
