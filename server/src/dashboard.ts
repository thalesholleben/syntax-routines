import type { ExecutorKind } from "./agents";
import type { Db } from "./db";
import type { RunStatus } from "./routines";
import { nextOccurrence, occurrencesBetween } from "./schedule";
import { readSettings } from "./settings";

const HOUR = 3_600_000;
interface Summary { succeeded: number; failed: number; skipped: number; canceled: number; averageMs: number | null }
interface ScheduleRow { id: number; name: string; agentKind: ExecutorKind; daysJson: string; time: string; intervalMinutes: number | null; isEnabled: number }
export interface DashboardRun {
  id: number; routineId: number; name: string; agentKind: ExecutorKind; status: RunStatus;
  startedAt: number | null; finishedAt: number | null; runAt: number | null; scheduledFor: number; attempt: number;
}
const RUN_SELECT = `SELECT r.id, r.routine_id AS "routineId", t.name,
  COALESCE(r.agent_kind, r.force_agent, t.agent_kind) AS "agentKind", r.status,
  r.started_at AS "startedAt", r.finished_at AS "finishedAt", r.run_at AS "runAt",
  r.scheduled_for AS "scheduledFor", r.attempt FROM runs r JOIN routines t ON t.id = r.routine_id`;

/** Read-only projection. No prompts, results, filesystem checks or scheduler writes. */
export function readDashboard(db: Db, now: number, hours: number) {
  const from = now - hours * HOUR;
  const summaryQuery = db.prepare(`SELECT
    COALESCE(SUM(status = 'SUCCEEDED'), 0) AS succeeded,
    COALESCE(SUM(status = 'FAILED'), 0) AS failed,
    COALESCE(SUM(status = 'SKIPPED'), 0) AS skipped,
    COALESCE(SUM(status = 'CANCELED'), 0) AS canceled,
    AVG(CASE WHEN status IN ('SUCCEEDED', 'FAILED') AND started_at IS NOT NULL
      THEN MAX(0, finished_at - started_at) END) AS "averageMs"
    FROM runs WHERE status NOT IN ('QUEUED', 'RUNNING')
      AND COALESCE(finished_at, created_at) > :from AND COALESCE(finished_at, created_at) <= :to`);
  const summary = summaryQuery.get({ from, to: now }) as unknown as Summary;
  const previous = summaryQuery.get({ from: from - hours * HOUR, to: from }) as unknown as Summary;
  const bucketMs = hours * HOUR / 24;
  const activityRows = db.prepare(`SELECT CAST((COALESCE(finished_at, created_at) - :from - 1) / :bucketMs AS INTEGER) AS bucket,
    SUM(status = 'SUCCEEDED') AS succeeded, SUM(status = 'FAILED') AS failed,
    SUM(status IN ('SKIPPED', 'CANCELED')) AS other
    FROM runs WHERE status NOT IN ('QUEUED', 'RUNNING')
      AND COALESCE(finished_at, created_at) > :from AND COALESCE(finished_at, created_at) <= :now GROUP BY bucket`)
    .all({ from, now, bucketMs }) as unknown as { bucket: number; succeeded: number; failed: number; other: number }[];
  const activity = Array.from({ length: 24 }, (_, bucket) => ({
    at: from + bucket * bucketMs, succeeded: 0, failed: 0, other: 0, ...activityRows.find(row => row.bucket === bucket)
  }));
  const activeCounts = db.prepare(`SELECT SUM(status = 'RUNNING') AS running, SUM(status = 'QUEUED') AS queued
    FROM runs WHERE status IN ('RUNNING', 'QUEUED')`).get() as { running: number | null; queued: number | null };
  const active = db.prepare(`${RUN_SELECT} WHERE r.status IN ('RUNNING', 'QUEUED')
    ORDER BY CASE r.status WHEN 'RUNNING' THEN 0 ELSE 1 END, r.run_at, r.id LIMIT 100`).all() as unknown as DashboardRun[];
  const recent = db.prepare(`${RUN_SELECT} WHERE r.status NOT IN ('QUEUED', 'RUNNING')
    AND COALESCE(r.finished_at, r.created_at) > :from AND COALESCE(r.finished_at, r.created_at) <= :now
    ORDER BY COALESCE(r.finished_at, r.created_at) DESC, r.id DESC LIMIT 50`).all({ from, now }) as unknown as DashboardRun[];
  const failures = db.prepare(`SELECT t.id AS "routineId", t.name, COUNT(*) AS count,
    MAX(r.finished_at) AS "lastAt", (SELECT x.id FROM runs x WHERE x.routine_id = t.id
      AND x.status = 'FAILED' AND x.finished_at > :from AND x.finished_at <= :now
      ORDER BY x.finished_at DESC, x.id DESC LIMIT 1) AS "runId"
    FROM runs r JOIN routines t ON t.id = r.routine_id
    WHERE r.status = 'FAILED' AND r.finished_at > :from AND r.finished_at <= :now
    GROUP BY t.id ORDER BY count DESC, "lastAt" DESC, t.id LIMIT 8`)
    .all({ from, now }) as unknown as { routineId: number; name: string; count: number; lastAt: number; runId: number }[];
  const routines = db.prepare(`SELECT id, name, agent_kind AS "agentKind", days_json AS "daysJson", time,
    interval_minutes AS "intervalMinutes", enabled AS "isEnabled" FROM routines`).all() as unknown as ScheduleRow[];
  const horizon = Array.from({ length: 24 }, (_, i) => ({ at: now + i * HOUR, CLAUDE: 0, CODEX: 0, SCRIPT: 0 }));
  const upcoming: { routineId: number; name: string; agentKind: ExecutorKind; at: number }[] = [];
  const nextByRoutine: typeof upcoming = [];
  for (const routine of routines) {
    if (!routine.isEnabled) continue;
    const spec = { days: JSON.parse(routine.daysJson) as number[], time: routine.time, intervalMinutes: routine.intervalMinutes };
    const next = nextOccurrence(spec, now);
    if (next !== null) nextByRoutine.push({ routineId: routine.id, name: routine.name, agentKind: routine.agentKind, at: next });
    for (const at of occurrencesBetween(spec, now, now + 24 * HOUR)) {
      const bucket = Math.min(23, Math.floor((at - now) / HOUR));
      horizon[bucket][routine.agentKind]++;
      upcoming.push({ routineId: routine.id, name: routine.name, agentKind: routine.agentKind, at });
    }
  }
  upcoming.sort((a, b) => a.at - b.at || a.routineId - b.routineId);
  nextByRoutine.sort((a, b) => a.at - b.at || a.routineId - b.routineId);
  // Bound the payload while preserving each hour's full count and first 12 occurrences.
  const agenda = horizon.map((slot, i) => ({ ...slot,
    events: upcoming.filter(event => Math.min(23, Math.floor((event.at - now) / HOUR)) === i).slice(0, 12)
  }));
  return { now, from, hours, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    summary, previous, activity, active, recent, failures,
    running: activeCounts.running ?? 0, queued: activeCounts.queued ?? 0,
    maxParallel: readSettings(db).maxParallel, routineCount: routines.length,
    enabledCount: routines.filter(routine => routine.isEnabled).length,
    upcomingCount: upcoming.length, next: nextByRoutine[0] ?? null,
    upcoming: upcoming.slice(0, 12), horizon: agenda };
}

export type DashboardSnapshot = ReturnType<typeof readDashboard>;
