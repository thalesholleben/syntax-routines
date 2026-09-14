import type { Db } from "./db";
import { DEFAULT_LANGUAGE, isLanguage, type Language } from "./i18n";

export interface Settings {
  rootDirectory: string;
  claudeBin: string;
  codexBin: string;
  maxParallel: number;
  bootDelayMinutes: number;
  /** Destinatario dos avisos de falha; vazio = sem aviso. */
  notifyEmail: string;
  /** Idioma das notas de execucao e do e-mail (o painel manda o dele por Accept-Language). */
  language: Language;
}

export const DEFAULT_SETTINGS: Settings = {
  rootDirectory: "",
  claudeBin: "claude",
  codexBin: "codex",
  maxParallel: 2,
  bootDelayMinutes: 10,
  notifyEmail: "",
  language: DEFAULT_LANGUAGE
};

const KEY_BY_FIELD: Record<keyof Settings, string> = {
  rootDirectory: "root_directory",
  claudeBin: "claude_bin",
  codexBin: "codex_bin",
  maxParallel: "max_parallel",
  bootDelayMinutes: "boot_delay_minutes",
  notifyEmail: "notify_email",
  language: "language"
};

export function readSettings(db: Db): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const pick = (field: keyof Settings) => stored.get(KEY_BY_FIELD[field]);
  return {
    rootDirectory: pick("rootDirectory") ?? DEFAULT_SETTINGS.rootDirectory,
    claudeBin: pick("claudeBin") ?? DEFAULT_SETTINGS.claudeBin,
    codexBin: pick("codexBin") ?? DEFAULT_SETTINGS.codexBin,
    maxParallel: Number(pick("maxParallel") ?? DEFAULT_SETTINGS.maxParallel),
    bootDelayMinutes: Number(pick("bootDelayMinutes") ?? DEFAULT_SETTINGS.bootDelayMinutes),
    notifyEmail: pick("notifyEmail") ?? DEFAULT_SETTINGS.notifyEmail,
    language: isLanguage(pick("language")) ? (pick("language") as Language) : DEFAULT_SETTINGS.language
  };
}

export function writeSettings(db: Db, patch: Partial<Settings>): void {
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT (key) DO UPDATE SET value = excluded.value"
  );
  for (const field of Object.keys(patch) as (keyof Settings)[]) {
    const value = patch[field];
    if (value !== undefined) upsert.run({ key: KEY_BY_FIELD[field], value: String(value) });
  }
}

/** Chave avulsa da tabela settings, para o que nao entra em `Settings` (a conta de envio do e-mail). */
export function getSetting(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = :key").get({ key }) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run({
    key,
    value
  });
}

export function deleteSetting(db: Db, key: string): void {
  db.prepare("DELETE FROM settings WHERE key = :key").run({ key });
}

export function getMeta(db: Db, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = :key").get({ key }) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (:key, :value) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run({
    key,
    value
  });
}
