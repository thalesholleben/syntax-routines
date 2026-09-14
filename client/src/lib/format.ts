import type { ExecutorKind, RunStatus } from "../types";

/** Ordem de exibicao: semana comecando na segunda. Os valores seguem Date.getDay (0 = domingo). */
export const WEEK_DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" }
];

export const AGENT_LABEL: Record<ExecutorKind, string> = { CLAUDE: "Claude Code", CODEX: "Codex", SCRIPT: "Script" };

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  QUEUED: "Na fila",
  RUNNING: "Executando",
  SUCCEEDED: "Concluída",
  FAILED: "Falhou",
  SKIPPED: "Pulada",
  CANCELED: "Cancelada"
};

export const RUN_STATUS_TONE: Record<RunStatus, string> = {
  QUEUED: "info",
  RUNNING: "primary",
  SUCCEEDED: "success",
  FAILED: "danger",
  SKIPPED: "muted",
  CANCELED: "muted"
};

export function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b).join(",");
  if (days.length === 7) return "Todo dia";
  if (sorted === "1,2,3,4,5") return "Seg a Sex";
  if (sorted === "0,6") return "Fim de semana";
  return WEEK_DAYS.filter((day) => days.includes(day.value))
    .map((day) => day.label)
    .join(", ");
}

/** "15 min", "1 h", "12 h". */
export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** "Seg a Sex às 09:00" ou "a cada 15 min, Seg a Sex". */
export function formatSchedule(days: number[], time: string, intervalMinutes: number | null): string {
  const when = formatDays(days) || "sem dia";
  return intervalMinutes === null ? `${when} às ${time}` : `a cada ${formatInterval(intervalMinutes)}, ${when}`;
}

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function formatDateTime(ms: number | null | undefined): string {
  return ms ? dateTimeFormat.format(ms) : "sem data";
}

export function formatRelative(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  const amount =
    minutes < 1 ? "menos de 1 min" : minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} d`;
  return diff >= 0 ? `em ${amount}` : `há ${amount}`;
}

export function formatDuration(startedAt: number | null, finishedAt: number | null): string {
  if (!startedAt) return "não iniciou";
  const seconds = Math.max(0, Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function basename(directory: string): string {
  const parts = directory.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? directory;
}
