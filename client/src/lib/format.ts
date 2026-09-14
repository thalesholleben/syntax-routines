import { useMemo } from "react";

import { LOCALE, messages, useI18n, type Language } from "../i18n";
import type { RunStatus } from "../types";

export const RUN_STATUS_TONE: Record<RunStatus, string> = {
  QUEUED: "info",
  RUNNING: "primary",
  SUCCEEDED: "success",
  FAILED: "danger",
  SKIPPED: "muted",
  CANCELED: "muted"
};

/** Ordem de exibicao: semana comecando na segunda. Os valores seguem Date.getDay (0 = domingo). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Formatadores no idioma do painel. Um objeto por idioma, criado uma vez (useFormat). */
export function createFormatters(language: Language) {
  const m = messages(language);
  const dateTimeFormat = new Intl.DateTimeFormat(LOCALE[language], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const weekDays = WEEK_ORDER.map((value) => ({ value, label: m.dayShort[value] }));

  function formatDays(days: number[]): string {
    const sorted = [...days].sort((a, b) => a - b).join(",");
    if (days.length === 7) return m.everyDay;
    if (sorted === "1,2,3,4,5") return m.weekdays;
    if (sorted === "0,6") return m.weekend;
    return weekDays
      .filter((day) => days.includes(day.value))
      .map((day) => day.label)
      .join(", ");
  }

  /** "15 min", "1 h", "12 h". */
  function formatInterval(minutes: number): string {
    if (minutes < 60) return m.minutes(minutes);
    return minutes % 60 === 0 ? m.hours(minutes / 60) : `${m.hours(Math.floor(minutes / 60))} ${m.minutes(minutes % 60)}`;
  }

  /** "Seg a Sex às 09:00" ou "a cada 15 min, Seg a Sex". */
  function formatSchedule(days: number[], time: string, intervalMinutes: number | null): string {
    const when = formatDays(days) || m.noDay;
    return intervalMinutes === null ? m.atTime(when, time) : m.everyN(formatInterval(intervalMinutes), when);
  }

  function formatDateTime(ms: number | null | undefined): string {
    return ms ? dateTimeFormat.format(ms) : m.noDate;
  }

  function formatRelative(ms: number, now = Date.now()): string {
    const diff = ms - now;
    const minutes = Math.round(Math.abs(diff) / 60_000);
    const amount =
      minutes < 1 ? m.lessThanMinute : minutes < 60 ? m.minutes(minutes) : minutes < 1440 ? m.hours(Math.round(minutes / 60)) : m.days(Math.round(minutes / 1440));
    return diff >= 0 ? m.inAmount(amount) : m.agoAmount(amount);
  }

  function formatDuration(startedAt: number | null, finishedAt: number | null): string {
    if (!startedAt) return m.notStarted;
    const seconds = Math.max(0, Math.round(((finishedAt ?? Date.now()) - startedAt) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  return {
    weekDays,
    agentLabel: m.agentLabel,
    runStatusLabel: m.runStatus,
    formatDays,
    formatInterval,
    formatSchedule,
    formatDateTime,
    formatRelative,
    formatDuration
  };
}

export type Formatters = ReturnType<typeof createFormatters>;

/** Formatadores do idioma atual do painel, recriados so quando o idioma muda. */
export function useFormat(): Formatters {
  const { language } = useI18n();
  return useMemo(() => createFormatters(language), [language]);
}

export function basename(directory: string): string {
  const parts = directory.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? directory;
}
