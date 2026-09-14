import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, SCHEMA_VERSION } from "./db";

// Schema exatamente como o app gravava antes da v2 (sem 'SCRIPT', sem command/interval_minutes/notified_at/notify_attempts).
const SCHEMA_V1 = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE routines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  agent_kind TEXT NOT NULL CHECK (agent_kind IN ('CLAUDE', 'CODEX')),
  directory TEXT NOT NULL,
  model TEXT,
  effort TEXT NOT NULL,
  timeout_minutes INTEGER NOT NULL,
  fallback_enabled INTEGER NOT NULL,
  days_json TEXT NOT NULL,
  time TEXT NOT NULL,
  prompt TEXT NOT NULL,
  missed_policy TEXT NOT NULL CHECK (missed_policy IN ('SKIP', 'RUN_ON_BOOT')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('SCHEDULE', 'MANUAL')),
  scheduled_for INTEGER NOT NULL,
  run_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELED')),
  force_agent TEXT CHECK (force_agent IN ('CLAUDE', 'CODEX')),
  agent_kind TEXT CHECK (agent_kind IN ('CLAUDE', 'CODEX')),
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  exit_code INTEGER,
  result TEXT,
  error TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX runs_schedule_once ON runs (routine_id, scheduled_for) WHERE trigger_type = 'SCHEDULE';
CREATE INDEX runs_due ON runs (status, run_at);
CREATE INDEX runs_routine ON runs (routine_id, id);
`;

let tmp = "";
let file = "";

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-db-")));
  file = path.join(tmp, "app.db");
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function createV1(): void {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA_V1);
  db.prepare(
    `INSERT INTO routines (id, name, agent_kind, directory, model, effort, timeout_minutes, fallback_enabled, days_json, time, prompt,
      missed_policy, enabled, created_at, updated_at)
    VALUES (7, 'Resumo', 'CODEX', 'C:\\p', 'gpt-5.6-sol', 'high', 30, 1, '[1,3]', '09:00', 'faz', 'RUN_ON_BOOT', 0, 100, 200)`
  ).run();
  db.prepare(
    `INSERT INTO runs (id, routine_id, trigger_type, scheduled_for, run_at, status, force_agent, agent_kind, attempt, started_at,
      finished_at, exit_code, result, error, note, created_at)
    VALUES (42, 7, 'SCHEDULE', 1000, 1000, 'FAILED', 'CLAUDE', 'CLAUDE', 2, 1001, 1002, 1, 'saida', 'erro', 'nota', 999)`
  ).run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('root_directory', 'C:\\p')").run();
  db.prepare("INSERT INTO meta (key, value) VALUES ('last_tick_at', '5')").run();
  db.close();
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name);
}

describe("openDb", () => {
  it("banco novo ja nasce na versao atual", () => {
    const db = openDb(file);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: String(SCHEMA_VERSION) });
    expect(columnsOf(db, "routines")).toContain("command");
    expect(columnsOf(db, "runs")).toContain("notify_attempts");
    db.close();
  });

  it("migra a v1 preservando rotina, execucao, ajustes e meta", () => {
    createV1();
    const db = openDb(file);

    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: "2" });
    expect(db.prepare("SELECT value FROM meta WHERE key = 'last_tick_at'").get()).toEqual({ value: "5" });
    expect(db.prepare("SELECT value FROM settings WHERE key = 'root_directory'").get()).toEqual({ value: "C:\\p" });

    const routine = db.prepare("SELECT * FROM routines").get() as Record<string, unknown>;
    expect(routine).toMatchObject({
      id: 7,
      name: "Resumo",
      agent_kind: "CODEX",
      model: "gpt-5.6-sol",
      effort: "high",
      timeout_minutes: 30,
      fallback_enabled: 1,
      days_json: "[1,3]",
      time: "09:00",
      prompt: "faz",
      missed_policy: "RUN_ON_BOOT",
      enabled: 0,
      created_at: 100,
      updated_at: 200,
      command: null,
      interval_minutes: null
    });
    // A execucao ligada a rotina sobrevive ao DROP da tabela pai (o cascade ficou desligado durante a migracao).
    const run = db.prepare("SELECT * FROM runs").get() as Record<string, unknown>;
    expect(run).toMatchObject({
      id: 42,
      routine_id: 7,
      status: "FAILED",
      force_agent: "CLAUDE",
      agent_kind: "CLAUDE",
      attempt: 2,
      result: "saida",
      error: "erro",
      note: "nota",
      created_at: 999,
      notified_at: null,
      notify_attempts: 0
    });

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'runs'").all() as { name: string }[]).map(
      (index) => index.name
    );
    expect(indexes).toEqual(expect.arrayContaining(["runs_schedule_once", "runs_due", "runs_routine"]));

    // O que a v2 existe para permitir.
    db.prepare(
      `INSERT INTO routines (name, agent_kind, directory, model, effort, timeout_minutes, fallback_enabled, days_json, time, prompt,
        missed_policy, command, interval_minutes, created_at, updated_at)
      VALUES ('Script', 'SCRIPT', 'C:\\p', NULL, '', 15, 0, '[1]', '00:00', '', 'SKIP', 'cmd /c echo oi', 15, 1, 1)`
    ).run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM routines WHERE agent_kind = 'SCRIPT'").get()).toEqual({ n: 1 });
    // Cascade continua funcionando depois da migracao.
    db.prepare("DELETE FROM routines WHERE id = 7").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 0 });
    db.close();
  });

  it("abrir de novo um banco ja migrado nao muda nada", () => {
    createV1();
    openDb(file).close();
    const db = openDb(file);
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toEqual({ value: "2" });
    db.close();
  });

  it("falha no meio da migracao deixa a v1 intacta e o pragma religado", () => {
    createV1();
    const raw = new DatabaseSync(file);
    raw.exec("CREATE TABLE routines_new (id INTEGER)"); // faz o CREATE da migracao falhar
    raw.close();

    expect(() => openDb(file)).toThrow(/routines_new/);

    const db = new DatabaseSync(file);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM routines").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 1 });
    expect(columnsOf(db, "routines")).not.toContain("command");
    db.close();
  });

  it("referencia quebrada em runs aborta a migracao", () => {
    createV1();
    const raw = new DatabaseSync(file);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.prepare("INSERT INTO runs (routine_id, trigger_type, scheduled_for, status, created_at) VALUES (999, 'MANUAL', 1, 'FAILED', 1)").run();
    raw.close();

    expect(() => openDb(file)).toThrow(/referência/);

    const db = new DatabaseSync(file);
    expect(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 2 });
    db.close();
  });
});
