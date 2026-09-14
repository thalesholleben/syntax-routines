import { readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import type { TextKey } from "./i18n";

// Mesmo bloqueio do worker do Syntax Ops: agente com acesso total nunca roda em pasta do sistema.
const FORBIDDEN_ROOTS = ["c:\\windows", "c:\\program files", "c:\\program files (x86)", "c:\\programdata"];
const UNSAFE_PATH_CHARS = /[%"]/;

/** Motivos possiveis, como chaves de mensagem: quem mostra escolhe o idioma (`messages(lang)[reason]`). */
export type DirectoryIssue = Extract<
  TextKey,
  "dirRootMissing" | "dirRootNotAbsolute" | "dirNotAbsolute" | "dirRootNotFound" | "dirNotFound" | "dirNotDirectory" | "dirUnsafeChars" | "dirSystem" | "dirOutsideRoot"
>;
export type DirectoryCheck = { ok: true; real: string } | { ok: false; reason: DirectoryIssue };

function resolveReal(value: string): { real: string; isDirectory: boolean } | null {
  try {
    const real = realpathSync.native(value);
    return { real, isDirectory: statSync(real).isDirectory() };
  } catch {
    return null;
  }
}

/**
 * Regra do worker (raiz + separador, sem caixa) aplicada sobre caminhos REAIS: junction ou symlink
 * dentro da pasta mae que aponta para fora e rejeitado. `path.relative` ja ignora caixa no Windows.
 */
export function checkDirectory(root: string, dir: string): DirectoryCheck {
  if (!root.trim()) return { ok: false, reason: "dirRootMissing" };
  if (!path.isAbsolute(root)) return { ok: false, reason: "dirRootNotAbsolute" };
  if (!path.isAbsolute(dir)) return { ok: false, reason: "dirNotAbsolute" };

  const realRoot = resolveReal(root);
  if (!realRoot?.isDirectory) return { ok: false, reason: "dirRootNotFound" };
  const target = resolveReal(dir);
  if (!target) return { ok: false, reason: "dirNotFound" };
  if (!target.isDirectory) return { ok: false, reason: "dirNotDirectory" };
  // O caminho vai citado na linha de comando do cmd, onde % expande variavel de ambiente mesmo entre aspas.
  if (UNSAFE_PATH_CHARS.test(target.real)) return { ok: false, reason: "dirUnsafeChars" };

  const lower = target.real.toLowerCase();
  if (FORBIDDEN_ROOTS.some((forbidden) => lower === forbidden || lower.startsWith(forbidden + path.sep))) {
    return { ok: false, reason: "dirSystem" };
  }

  const relative = path.relative(realRoot.real, target.real);
  const isInside =
    relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  return isInside ? { ok: true, real: target.real } : { ok: false, reason: "dirOutsideRoot" };
}

/** Pasta mae + subpastas imediatas (sem ocultas e node_modules), como o worker publica no heartbeat. */
export function listDirectories(root: string): string[] {
  if (!root.trim() || !path.isAbsolute(root)) return [];
  const realRoot = resolveReal(root);
  if (!realRoot?.isDirectory) return [];
  try {
    const children = readdirSync(realRoot.real, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => path.join(realRoot.real, entry.name))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    return [realRoot.real, ...children];
  } catch {
    return [realRoot.real];
  }
}
