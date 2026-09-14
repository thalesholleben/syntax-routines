import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb } from "../server/src/db";
import { writeSettings } from "../server/src/settings";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(projectDir, "node_modules", "tsx", "dist", "cli.mjs");
const script = path.join(projectDir, "scripts", "import-routines.ts");

let tmp = "";
let root = "";
let dataDir = "";

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-import-")));
  root = path.join(tmp, "pasta-mae");
  dataDir = path.join(tmp, "data");
  mkdirSync(path.join(root, "ferramentas", "instagram"), { recursive: true });
  mkdirSync(path.join(root, "clientes", "loja"), { recursive: true });
  const db = openDb(path.join(dataDir, "app.db"));
  writeSettings(db, { rootDirectory: root });
  db.close();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runImport(file: string) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", tsxCli, script, file, "--data", dataDir], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 60_000
  });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

function writeJson(name: string, routines: unknown[]): string {
  const file = path.join(tmp, name);
  writeFileSync(file, JSON.stringify({ routines }, null, 2));
  return file;
}

function readNames(): string[] {
  const db = openDb(path.join(dataDir, "app.db"));
  const rows = db.prepare("SELECT name, agent_kind AS kind, directory, command, interval_minutes AS interval FROM routines ORDER BY id").all() as {
    name: string;
  }[];
  db.close();
  return rows.map((row) => JSON.stringify(row));
}

const script15 = {
  name: "Fila do Instagram",
  agentKind: "SCRIPT",
  directory: "ferramentas\\instagram",
  model: null,
  effort: "",
  timeoutMinutes: 20,
  isFallbackEnabled: false,
  days: [0, 1, 2, 3, 4, 5, 6],
  time: "00:00",
  intervalMinutes: 15,
  prompt: "",
  command: "powershell -NoProfile -File publicar.ps1",
  missedPolicy: "SKIP",
  isEnabled: true
};

const agentWeekly = {
  name: "Resumo do Google Ads",
  agentKind: "CLAUDE",
  directory: path.join(root, "clientes", "loja"),
  model: "claude-opus-5",
  effort: "high",
  timeoutMinutes: 60,
  isFallbackEnabled: true,
  days: [1],
  time: "09:00",
  intervalMinutes: null,
  prompt: "faz o resumo",
  command: "",
  missedPolicy: "RUN_ON_BOOT",
  isEnabled: true
};

// Cada comando sobe um tsx (~1,5 s); com a maquina ocupada o teste passa dos 5 s padrao do vitest.
describe("import-routines", { timeout: 30_000 }, () => {
  it("importa com a validacao das rotas, resolve diretorio relativo a pasta mae e pula repetidas na segunda vez", () => {
    const file = writeJson("ok.json", [script15, agentWeekly]);
    const first = runImport(file);
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain("criada #1: Fila do Instagram [SCRIPT]");
    expect(first.out).toContain("criada #2: Resumo do Google Ads [CLAUDE]");
    expect(readNames()).toEqual([
      JSON.stringify({ name: "Fila do Instagram", kind: "SCRIPT", directory: path.join(root, "ferramentas", "instagram"), command: "powershell -NoProfile -File publicar.ps1", interval: 15 }),
      JSON.stringify({ name: "Resumo do Google Ads", kind: "CLAUDE", directory: path.join(root, "clientes", "loja"), command: null, interval: null })
    ]);

    const second = runImport(file);
    expect(second.code, second.out).toBe(0);
    expect(second.out).toContain("pulada (já existe): Fila do Instagram");
    expect(second.out).toContain("0 criada(s), 2 pulada(s)");
    expect(readNames()).toHaveLength(2);
  });

  it("um item invalido ou fora da pasta mae impede o arquivo inteiro", () => {
    const invalid = writeJson("invalido.json", [script15, { ...agentWeekly, name: "Sem prompt", prompt: "   " }]);
    const result = runImport(invalid);
    expect(result.code).toBe(1);
    expect(result.out).toContain("nada foi importado");
    expect(result.out).toContain("Sem prompt");
    expect(readNames()).toHaveLength(0);

    const outside = writeJson("fora.json", [{ ...script15, directory: tmp }]);
    const outsideResult = runImport(outside);
    expect(outsideResult.code).toBe(1);
    expect(outsideResult.out).toContain("fora da pasta mãe");
    expect(readNames()).toHaveLength(0);
  });
});
