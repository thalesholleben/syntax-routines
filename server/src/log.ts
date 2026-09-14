import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

let logFile: string | null = null;

/** Liga a copia do log em arquivo (data/app.log). Sem isso, so console. */
export function setLogFile(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  logFile = file;
}

export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (!process.env.VITEST) console.log(line);
  if (!logFile) return;
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    /* log em arquivo nao pode derrubar o app */
  }
}
