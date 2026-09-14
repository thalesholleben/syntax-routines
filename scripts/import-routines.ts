// Importa rotinas de um JSON direto no banco, sem sessao HTTP (a senha do painel e so do dono do PC).
// Usa a MESMA validacao e a MESMA escrita das rotas: nao existe um segundo caminho para dado invalido entrar.
//   npm run import -- docs/exemplos/rotinas-exemplo.json          # banco padrao (data/app.db)
//   npm run import -- minhas-rotinas.json --data C:\outra\pasta    # outro DATA_DIR
// Formato: { "routines": [ <payload igual ao POST /api/routines> ] }. `directory` pode ser absoluto ou relativo a
// pasta mae configurada em Ajustes. Rotina com nome ja existente (sem diferenciar caixa) e pulada.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { openDb, transaction } from "../server/src/db";
import { createRoutine, type RoutineInput } from "../server/src/routines";
import { readSettings } from "../server/src/settings";
import { prepareRoutine } from "./routine-input";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]): { file: string; dataDir: string } {
  let file = "";
  let dataDir = path.join(projectDir, "data");
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--data") {
      dataDir = path.resolve(argv[++index] ?? "");
    } else if (!file) {
      file = path.resolve(arg);
    }
  }
  if (!file) {
    console.error("uso: npm run import -- <rotinas.json> [--data <pasta>]");
    process.exit(2);
  }
  return { file, dataDir };
}

const fileSchema = z.object({ routines: z.array(z.unknown()).min(1, "o arquivo precisa de pelo menos uma rotina") });

const { file, dataDir } = parseArgs(process.argv.slice(2));
const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
const parsedFile = fileSchema.safeParse(raw);
if (!parsedFile.success) {
  console.error(`arquivo inválido: ${z.prettifyError(parsedFile.error)}`);
  process.exit(1);
}

const db = openDb(path.join(dataDir, "app.db"));
try {
  const { rootDirectory } = readSettings(db);
  if (!rootDirectory) {
    console.error("defina a pasta mãe em Ajustes antes de importar (a validação de diretório depende dela).");
    process.exit(1);
  }
  const existing = new Set(
    (db.prepare("SELECT name FROM routines").all() as { name: string }[]).map((row) => row.name.trim().toLowerCase())
  );

  // Valida tudo antes de gravar qualquer coisa: ou entra o arquivo inteiro, ou nada.
  const toCreate: RoutineInput[] = [];
  const problems: string[] = [];
  const skipped: string[] = [];
  parsedFile.data.routines.forEach((item, index) => {
    const label = `rotina #${index + 1}`;
    const record = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const prepared = prepareRoutine(rootDirectory, record);
    if (!prepared.ok) {
      problems.push(`${label} (${String(record.name ?? "sem nome")}): ${prepared.problem}`);
      return;
    }
    const { input } = prepared;
    if (existing.has(input.name.trim().toLowerCase())) {
      skipped.push(input.name);
      return;
    }
    existing.add(input.name.trim().toLowerCase());
    toCreate.push(input);
  });

  if (problems.length > 0) {
    console.error("nada foi importado; corrija o arquivo:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const now = Date.now();
  transaction(db, () => {
    for (const input of toCreate) {
      const id = createRoutine(db, input, now);
      console.log(`criada #${id}: ${input.name} [${input.agentKind}]`);
    }
  });
  for (const name of skipped) console.log(`pulada (já existe): ${name}`);
  console.log(`${toCreate.length} criada(s), ${skipped.length} pulada(s), banco ${path.join(dataDir, "app.db")}`);
} finally {
  db.close();
}
