import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

let logFile: string | null = null;

/** Liga a copia do log em arquivo (data/app.log); `null` desliga. Sem isso, so console. */
export function setLogFile(file: string | null): void {
  if (file) mkdirSync(path.dirname(file), { recursive: true });
  logFile = file;
}

/** Endereco de e-mail no log sai mascarado (`d***@dominio`): o log fica em disco e vai parar em print de suporte. */
export function maskEmails(text: string): string {
  return text.replace(/([^\s@<>"'(),;:])[^\s@<>"'(),;:]*@([^\s@<>"'(),;:]+)/g, "$1***@$2");
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
