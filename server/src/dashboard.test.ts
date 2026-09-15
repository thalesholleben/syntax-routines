import { afterEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./db";
import { readDashboard } from "./dashboard";
import { createRoutine, type RunStatus } from "./routines";

let db: Db;
const now = new Date(2026, 8, 15, 10, 0).getTime();
const HOUR = 3_600_000;
afterEach(() => db?.close());

function fixture() {
  db = openDb(":memory:");
  return createRoutine(db, { name: "Every five minutes", agentKind: "SCRIPT", directory: "unused", model: null,
    effort: "", timeoutMinutes: 10, isFallbackEnabled: false, days: [0, 1, 2, 3, 4, 5, 6], time: "00:00",
    intervalMinutes: 5, prompt: "private prompt", command: "private command", missedPolicy: "SKIP", isEnabled: true }, now);
}
function run(routineId: number, status: RunStatus, at: number, duration: number | null = null) {
  db.prepare(`INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, started_at, finished_at, created_at)
    VALUES (?, 'MANUAL', ?, ?, ?, ?, ?, ?)`).run(routineId, at, at, status,
      duration === null ? null : at - duration, ["QUEUED", "RUNNING", "SKIPPED"].includes(status) ? null : at, at);
}

describe("dashboard read model", () => {
  it("counts every result, separates skipped/canceled, compares periods and never writes", () => {
    const id = fixture();
    for (let i = 0; i < 75; i++) run(id, "SUCCEEDED", now - i * 1000, 2000);
    run(id, "FAILED", now - HOUR, 4000);
    run(id, "FAILED", now - 2 * HOUR); // rejected before spawning is still a failure
    run(id, "SKIPPED", now - HOUR);
    run(id, "CANCELED", now - HOUR);
    run(id, "FAILED", now - 24 * HOUR); // exact lower boundary belongs to previous
    run(id, "SUCCEEDED", now + 1000); // future timestamp is excluded
    run(id, "RUNNING", now - 50 * HOUR);
    run(id, "QUEUED", now - 50 * HOUR);
    const changes = db.prepare("SELECT total_changes() AS count").get();
    const result = readDashboard(db, now, 24);
    expect(result.summary).toMatchObject({ succeeded: 75, failed: 2, skipped: 1, canceled: 1 });
    expect(result.summary.averageMs).toBeCloseTo((75 * 2000 + 4000) / 76);
    expect(result.previous.failed).toBe(1);
    expect(result.activity.reduce((sum, row) => sum + row.succeeded + row.failed + row.other, 0)).toBe(79);
    expect(result.recent).toHaveLength(50);
    expect(result.failures[0].count).toBe(2);
    expect(result.running).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.active).toHaveLength(2);
    expect(db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
    expect(JSON.stringify(result)).not.toMatch(/private prompt|private command/);
  });

  it("forecasts every interval occurrence for 100 routines with bounded lists and no paused routines", () => {
    const id = fixture();
    for (let i = 1; i < 100; i++) db.prepare(`INSERT INTO routines
      (name, agent_kind, directory, model, effort, timeout_minutes, fallback_enabled, days_json, time,
       interval_minutes, prompt, command, missed_policy, enabled, created_at, updated_at)
      SELECT name || ?, agent_kind, directory, model, effort, timeout_minutes, fallback_enabled, days_json, time,
       interval_minutes, prompt, command, missed_policy, enabled, created_at, updated_at FROM routines WHERE id = ?`).run(i, id);
    db.prepare("UPDATE routines SET enabled = 0 WHERE id = ?").run(id);
    const result = readDashboard(db, now, 24);
    expect(result.routineCount).toBe(100);
    expect(result.enabledCount).toBe(99);
    expect(result.upcomingCount).toBe(99 * 288);
    expect(result.horizon.reduce((sum, row) => sum + row.SCRIPT, 0)).toBe(result.upcomingCount);
    expect(result.upcoming).toHaveLength(12);
    expect(result.horizon.every(row => row.events.length <= 12)).toBe(true);
    expect(result.next?.at).toBe(now + 5 * 60_000);
    expect(result.upcoming.every(row => row.routineId !== id)).toBe(true);
  });

  it("returns honest empty metrics and keeps a weekly next event beyond the 24h horizon", () => {
    const id = fixture();
    db.prepare("UPDATE routines SET interval_minutes = NULL, days_json = '[1]', time = '09:00' WHERE id = ?").run(id);
    const result = readDashboard(db, now, 24);
    expect(result.summary).toEqual({ succeeded: 0, failed: 0, skipped: 0, canceled: 0, averageMs: null });
    expect(result.upcomingCount).toBe(0);
    expect(result.next?.at).toBe(new Date(2026, 8, 21, 9, 0).getTime());
    expect(result.active).toEqual([]);
  });
});
