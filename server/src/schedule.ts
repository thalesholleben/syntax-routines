// Calculo puro das ocorrencias de uma rotina em horario local: dias da semana + HH:MM, ou dias da semana +
// "a cada N minutos" (grade alinhada a meia-noite local). Sem banco e sem relogio: quem chama passa os instantes em ms.

export const GRACE_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 1440;
const MAX_SCAN_DAYS = 400;

export type MissedPolicy = "SKIP" | "RUN_ON_BOOT";

export interface ScheduleSpec {
  /** 0 = domingo ... 6 = sabado. */
  days: readonly number[];
  /** HH:MM em horario local (ignorado quando ha intervalo). */
  time: string;
  /** "A cada N minutos" nos dias marcados; nulo ou ausente = hora fixa. */
  intervalMinutes?: number | null;
}

export interface PlannedRun {
  scheduledFor: number;
  status: "QUEUED" | "SKIPPED";
  runAt: number | null;
  note: string | null;
}

function localAt(base: Date, dayOffset: number, minutesOfDay: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, 0, minutesOfDay, 0, 0);
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutos do dia em que a rotina dispara: um so (hora fixa) ou a grade do intervalo. */
function slotsOfDay(spec: ScheduleSpec): number[] {
  const interval = spec.intervalMinutes ?? null;
  if (interval === null) return [timeToMinutes(spec.time)];
  const slots: number[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += interval) slots.push(minute);
  return slots;
}

/** Ocorrencias em (fromMs, toMs], em ordem crescente. Janela maior que 400 dias considera so o fim. */
export function occurrencesBetween(spec: ScheduleSpec, fromMs: number, toMs: number): number[] {
  if (toMs <= fromMs || spec.days.length === 0) return [];
  const base = new Date(Math.max(fromMs, toMs - MAX_SCAN_DAYS * DAY_MS));
  const slots = slotsOfDay(spec);
  const result: number[] = [];
  for (let offset = 0; ; offset++) {
    const midnight = localAt(base, offset, 0);
    if (midnight.getTime() > toMs) break;
    if (!spec.days.includes(midnight.getDay())) continue;
    for (const slot of slots) {
      const at = localAt(base, offset, slot).getTime();
      if (at > fromMs && at <= toMs) result.push(at);
    }
  }
  return result;
}

/** Proxima ocorrencia estritamente depois de nowMs, ou null sem dias marcados. */
export function nextOccurrence(spec: ScheduleSpec, nowMs: number): number | null {
  if (spec.days.length === 0) return null;
  const base = new Date(nowMs);
  const slots = slotsOfDay(spec);
  for (let offset = 0; offset <= 7; offset++) {
    const midnight = localAt(base, offset, 0);
    if (!spec.days.includes(midnight.getDay())) continue;
    for (const slot of slots) {
      const at = localAt(base, offset, slot).getTime();
      if (at > nowMs) return at;
    }
  }
  return null;
}

/**
 * Decide o destino das ocorrencias de UMA rotina numa janela de tick. So a mais recente pode rodar:
 * com atraso ate graceMs roda ja; atrasada segue a politica de PC desligado; as anteriores sao
 * substituidas por ela. Rotina por intervalo nao tem politica de PC desligado: a proxima ocorrencia
 * esta a no maximo um intervalo de distancia, entao a atrasada e descartada sem deixar linha, e as
 * anteriores nem sao materializadas (seriam dezenas de "puladas" por dia).
 */
export function planWindow(
  occurrences: readonly number[],
  nowMs: number,
  policy: MissedPolicy,
  delayMs: number,
  graceMs = GRACE_MS,
  options: { isInterval?: boolean } = {}
): PlannedRun[] {
  if (occurrences.length === 0) return [];
  const sorted = [...occurrences].sort((a, b) => a - b);
  const latest = sorted[sorted.length - 1];
  if (options.isInterval) {
    return nowMs - latest <= graceMs ? [{ scheduledFor: latest, status: "QUEUED", runAt: latest, note: null }] : [];
  }
  const plans = sorted.slice(0, -1).map(
    (scheduledFor): PlannedRun => ({
      scheduledFor,
      status: "SKIPPED",
      runAt: null,
      note: "Substituída pela ocorrência mais recente."
    })
  );
  if (nowMs - latest <= graceMs) {
    plans.push({ scheduledFor: latest, status: "QUEUED", runAt: latest, note: null });
  } else if (policy === "RUN_ON_BOOT") {
    plans.push({
      scheduledFor: latest,
      status: "QUEUED",
      runAt: nowMs + delayMs,
      note: `PC desligado no horário; executada ao ligar, com atraso de ${Math.round(delayMs / 60_000)} min.`
    });
  } else {
    plans.push({ scheduledFor: latest, status: "SKIPPED", runAt: null, note: "PC desligado ou app fechado no horário." });
  }
  return plans;
}
