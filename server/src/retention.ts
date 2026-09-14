import { unlinkSync } from "node:fs";
import path from "node:path";

import type { Db } from "./db";

export const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Apaga execucoes terminadas ha mais de RETENTION_DAYS e os logs delas. Fila e execucao em andamento nunca saem, e a
 * ultima execucao terminada de cada rotina (a que a lista mostra em "Ultima", mesma ordenacao de listRoutines) fica
 * mesmo velha, para a lista nunca mostrar "nunca rodou" numa rotina que rodou.
 * Rotina de 15 min gera ~100 linhas por dia; sem isto o banco e a pasta de logs so crescem.
 */
export function purgeOldRuns(db: Db, logsDir: string, nowMs: number): number {
  const cutoff = nowMs - RETENTION_DAYS * DAY_MS;
  const rows = db
    .prepare(
      `DELETE FROM runs WHERE id IN (
        SELECT id FROM runs AS old
        WHERE old.status NOT IN ('QUEUED', 'RUNNING')
          AND COALESCE(old.finished_at, old.created_at) < :cutoff
          AND old.id <> (
            SELECT latest.id FROM runs AS latest
            WHERE latest.routine_id = old.routine_id AND latest.status NOT IN ('QUEUED', 'RUNNING')
            ORDER BY COALESCE(latest.finished_at, latest.created_at) DESC, latest.id DESC LIMIT 1
          )
      ) RETURNING id`
    )
    .all({ cutoff }) as { id: number }[];
  for (const { id } of rows) {
    try {
      unlinkSync(path.join(logsDir, `${id}.log`));
    } catch {
      /* log que nunca existiu ou ja foi apagado */
    }
  }
  return rows.length;
}
