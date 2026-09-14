// Politica de retry para jobs dos agentes secundarios (Claude/Codex).
// - Limite de uso (rate limit com horario de reset): reagenda para reset + 5 min.
// - Erro transitorio: backoff exponencial.
// - Apos maxAttempts: FAILED (terminal).

const RETRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutos apos o reset informado
const BASE_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
const DEFAULT_LIMIT_BACKOFF_MS = 60 * 60 * 1000; // 1h se detectou limite mas sem horario

export type ErrorClass = "limit" | "transient" | "fatal";

const LIMIT_MARKERS = [
  /usage limit/i,
  /rate.?limit/i,
  /\blimit reached\b/i,
  /too many requests/i,
  /\b429\b/,
  /quota/i,
  /resets? (?:at|in)/i,
  /try again (?:later|in)/i,
  /overloaded/i
];

const FATAL_MARKERS = [
  /not authenticated/i,
  /authentication (?:failed|error)/i,
  /invalid api key/i,
  /permission denied/i,
  /command not found/i,
  /no such file or directory/i,
  /ENOENT/i,
  // Windows com shell: binario inexistente nao gera ENOENT; o cmd imprime isto e sai com codigo 1.
  /is not recognized as an internal or external command/i,
  /n[aã]o [eé] reconhecido como um comando interno/i
];

export function classifyError(text: string): ErrorClass {
  const sample = text.slice(0, 8000);
  if (LIMIT_MARKERS.some((re) => re.test(sample))) return "limit";
  if (FATAL_MARKERS.some((re) => re.test(sample))) return "fatal";
  return "transient";
}

/**
 * Tenta extrair o horario de reset do limite a partir do stdout/stderr.
 * Suporta "resets at 3pm", "resets at 15:00", "try again in 2 hours", epoch e ISO.
 */
export function parseLimitReset(text: string, now = new Date()): Date | null {
  const sample = text.slice(0, 8000);

  // ISO 8601
  const iso = /resets?\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)/i.exec(sample);
  if (iso) {
    const date = new Date(iso[1]);
    if (!Number.isNaN(date.getTime())) return date;
  }

  // epoch seconds (10 digitos) ou ms (13 digitos)
  const epoch = /reset[^0-9]{0,20}(\d{10,13})/i.exec(sample);
  if (epoch) {
    const num = Number(epoch[1]);
    const date = new Date(epoch[1].length >= 13 ? num : num * 1000);
    if (!Number.isNaN(date.getTime()) && date.getTime() > now.getTime()) return date;
  }

  // "try again in 2 hours" / "in 45 minutes" / "in 30 seconds"
  const relative = /(?:try again|reset[s]?)\s+in\s+(\d+)\s*(second|minute|hour|day)s?/i.exec(sample);
  if (relative) {
    const amount = Number(relative[1]);
    const unitMs = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 }[relative[2].toLowerCase()] ?? 60_000;
    return new Date(now.getTime() + amount * unitMs);
  }

  // "resets at 3pm" / "resets at 3:30am" / "reset at 15:00" / Codex: "try again at 7:45 AM"
  const clock = /(?:reset[s]?|try again)\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(sample);
  if (clock) {
    const hour12 = Number(clock[1]);
    const minutes = clock[2] ? Number(clock[2]) : 0;
    const meridiem = clock[3]?.toLowerCase();
    let hour = hour12;
    if (meridiem === "pm" && hour12 < 12) hour += 12;
    if (meridiem === "am" && hour12 === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minutes >= 0 && minutes <= 59) {
      const target = new Date(now);
      target.setHours(hour, minutes, 0, 0);
      if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
      return target;
    }
  }

  return null;
}

export interface RetryDecision {
  status: "ERROR" | "FAILED";
  nextRetryAt: Date | null;
  reason: ErrorClass;
  /** Horário bruto de reset informado pelo CLI (sem o buffer de 5 min). Só presente em erros de limite. */
  rawResetAt?: Date | null;
}

/** Decide o proximo passo de retry para um job que falhou. */
export function decideRetry(input: {
  text: string;
  attemptCount: number;
  maxAttempts: number;
  now?: Date;
}): RetryDecision {
  const now = input.now ?? new Date();
  const klass = classifyError(input.text);

  if (klass === "fatal") {
    return { status: "FAILED", nextRetryAt: null, reason: klass };
  }
  if (input.attemptCount >= input.maxAttempts) {
    return { status: "FAILED", nextRetryAt: null, reason: klass };
  }

  if (klass === "limit") {
    const reset = parseLimitReset(input.text, now);
    const nextRetryAt = reset
      ? new Date(reset.getTime() + RETRY_BUFFER_MS)
      : new Date(now.getTime() + DEFAULT_LIMIT_BACKOFF_MS);
    return { status: "ERROR", nextRetryAt, reason: klass, rawResetAt: reset };
  }

  // transitorio: backoff exponencial com teto
  const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, input.attemptCount - 1));
  return { status: "ERROR", nextRetryAt: new Date(now.getTime() + backoff), reason: klass };
}
