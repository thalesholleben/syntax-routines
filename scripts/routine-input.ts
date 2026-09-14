// Validacao de uma rotina vinda de arquivo (import em lote e CLI). Usa o MESMO schema das rotas da API:
// nao existe um segundo caminho para dado invalido entrar no banco (invariante 11 do AGENTS.md).
import path from "node:path";

import { z } from "zod";

import { checkDirectory } from "../server/src/directories";
import { DEFAULT_LANGUAGE, messages } from "../server/src/i18n";
import type { RoutineInput } from "../server/src/routines";
import { normalizeRoutine, routineSchema } from "../server/src/routes";

export type PreparedRoutine = { ok: true; input: RoutineInput } | { ok: false; problem: string };

/**
 * Resolve `directory` (absoluto ou relativo a pasta mae), valida pelo schema das rotas e confere a pasta.
 * Devolve o problema em uma linha, pronto para a saida do terminal.
 */
export function prepareRoutine(rootDirectory: string, record: Record<string, unknown>): PreparedRoutine {
  const directoryRaw = typeof record.directory === "string" ? record.directory : "";
  const candidate = { ...record, directory: directoryRaw ? path.resolve(rootDirectory, directoryRaw) : "" };
  const result = routineSchema.safeParse(candidate);
  if (!result.success) return { ok: false, problem: z.prettifyError(result.error).replace(/\n/g, " ") };

  const input = normalizeRoutine(result.data);
  const directory = checkDirectory(rootDirectory, input.directory);
  if (!directory.ok) return { ok: false, problem: `${messages(DEFAULT_LANGUAGE)[directory.reason]} (${input.directory})` };
  return { ok: true, input: { ...input, directory: directory.real } };
}
