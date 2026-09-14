import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export const SCHEMA_VERSION = 2;
const SCHEMA_VERSION_KEY = "schema_version";

// Colunas em snake_case; toda leitura sai com alias camelCase (`AS "campo"`).
// As definicoes de routines e runs ficam separadas porque a migracao recria as duas tabelas com outro nome.
const ROUTINES_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  agent_kind TEXT NOT NULL CHECK (agent_kind IN ('CLAUDE', 'CODEX', 'SCRIPT')),
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
  command TEXT,
  interval_minutes INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL`;

const RUNS_COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id INTEGER NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('SCHEDULE', 'MANUAL')),
  scheduled_for INTEGER NOT NULL,
  run_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELED')),
  force_agent TEXT CHECK (force_agent IN ('CLAUDE', 'CODEX')),
  agent_kind TEXT CHECK (agent_kind IN ('CLAUDE', 'CODEX', 'SCRIPT')),
  attempt INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  exit_code INTEGER,
  result TEXT,
  error TEXT,
  note TEXT,
  notified_at INTEGER,
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL`;

// Uma linha por ocorrencia agendada: replay da mesma janela (crash, relogio voltando) vira no-op.
const INDEXES = `
CREATE UNIQUE INDEX IF NOT EXISTS runs_schedule_once ON runs (routine_id, scheduled_for) WHERE trigger_type = 'SCHEDULE';
CREATE INDEX IF NOT EXISTS runs_due ON runs (status, run_at);
CREATE INDEX IF NOT EXISTS runs_routine ON runs (routine_id, id);
`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS routines (${ROUTINES_COLUMNS}
);

CREATE TABLE IF NOT EXISTS runs (${RUNS_COLUMNS}
);
${INDEXES}`;

// Colunas da v1, na ordem da v1: e o que a migracao copia (as novas ficam com o padrao).
const ROUTINES_V1_COLUMNS =
  "id, name, agent_kind, directory, model, effort, timeout_minutes, fallback_enabled, days_json, time, prompt, missed_policy, enabled, created_at, updated_at";
const RUNS_V1_COLUMNS =
  "id, routine_id, trigger_type, scheduled_for, run_at, status, force_agent, agent_kind, attempt, started_at, finished_at, exit_code, result, error, note, created_at";

function readSchemaVersion(db: Db): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = :key").get({ key: SCHEMA_VERSION_KEY }) as { value: string } | undefined;
  return row ? Number(row.value) : 1;
}

function writeSchemaVersion(db: Db, version: number): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run({
    key: SCHEMA_VERSION_KEY,
    value: String(version)
  });
}

/**
 * v1 -> v2: `agent_kind` aceita 'SCRIPT', routines ganha `command` e `interval_minutes`, runs ganha `notified_at` e
 * `notify_attempts`. SQLite nao altera CHECK, entao e o procedimento oficial de recriar a tabela. O pragma de chave
 * estrangeira e desligado ANTES do BEGIN (dentro de transacao ele nao faz nada), senao o DROP de routines levaria
 * as execucoes junto pelo ON DELETE CASCADE; a conferencia `foreign_key_check` roda antes do COMMIT.
 */
function migrateV1ToV2(db: Db): void {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`CREATE TABLE routines_new (${ROUTINES_COLUMNS})`);
      db.exec(`INSERT INTO routines_new (${ROUTINES_V1_COLUMNS}) SELECT ${ROUTINES_V1_COLUMNS} FROM routines`);
      db.exec("DROP TABLE routines");
      db.exec("ALTER TABLE routines_new RENAME TO routines");

      db.exec(`CREATE TABLE runs_new (${RUNS_COLUMNS})`);
      db.exec(`INSERT INTO runs_new (${RUNS_V1_COLUMNS}) SELECT ${RUNS_V1_COLUMNS} FROM runs`);
      db.exec("DROP TABLE runs");
      db.exec("ALTER TABLE runs_new RENAME TO runs");
      db.exec(INDEXES);

      const violations = db.prepare("PRAGMA foreign_key_check").all();
      if (violations.length > 0) throw new Error(`migração v2: ${violations.length} referência(s) quebrada(s) em runs.routine_id`);
      writeSchemaVersion(db, 2);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/** Abre (ou cria) o banco. Idempotente: nao altera linhas existentes; migra o schema quando ele e de uma versao anterior. */
export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  const isNew = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'routines'").get() === undefined;
  try {
    db.exec(SCHEMA);
    if (isNew) {
      writeSchemaVersion(db, SCHEMA_VERSION);
    } else if (readSchemaVersion(db) < 2) {
      migrateV1ToV2(db);
    }
  } catch (error) {
    // Sem fechar, o arquivo fica preso ate o processo morrer (no Windows nem apagar da).
    db.close();
    throw error;
  }
  return db;
}

/** Transacao com lock de escrita desde o inicio (evita SQLITE_BUSY ao promover leitura para escrita). */
export function transaction<T>(db: Db, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
