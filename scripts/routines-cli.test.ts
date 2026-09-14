import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb } from "../server/src/db";
import { getRoutine, toRoutineFields } from "../server/src/routines";
import { routineSchema } from "../server/src/routes";
import { setSetting, writeSettings } from "../server/src/settings";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(projectDir, "node_modules", "tsx", "dist", "cli.mjs");
const script = path.join(projectDir, "scripts", "routines-cli.ts");

let tmp = "";
let root = "";
let dataDir = "";

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-cli-")));
  root = path.join(tmp, "pasta-mae");
  dataDir = path.join(tmp, "data");
  mkdirSync(path.join(root, "projeto"), { recursive: true });
  const db = openDb(path.join(dataDir, "app.db"));
  writeSettings(db, { rootDirectory: root });
  db.close();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// O .env do projeto (se existir nesta maquina) fica de fora: o CLI descreveria a conta de envio de quem roda o teste.
function cliEnv(): NodeJS.ProcessEnv {
  const emptyEnv = path.join(tmp, "vazio.env");
  writeFileSync(emptyEnv, "");
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SMTP_|MAIL_FROM_)/.test(key)));
  return { ...inherited, ENV_FILE: emptyEnv };
}

function cli(...args: string[]) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", tsxCli, script, ...args, "--data", dataDir], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 60_000,
    env: cliEnv()
  });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}`, stdout: result.stdout };
}

function writeJson(name: string, value: unknown): string {
  const file = path.join(tmp, name);
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function stored(id: number) {
  const db = openDb(path.join(dataDir, "app.db"));
  const row = getRoutine(db, id);
  db.close();
  return row ? toRoutineFields(row) : null;
}

const scriptRoutine = {
  name: "Fila do Instagram",
  agentKind: "SCRIPT",
  directory: "projeto",
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

const agentRoutine = {
  ...scriptRoutine,
  name: "Resumo do Google Ads",
  agentKind: "CLAUDE",
  model: "claude-opus-5",
  effort: "high",
  timeoutMinutes: 60,
  isFallbackEnabled: true,
  days: [1],
  time: "09:00",
  intervalMinutes: null,
  prompt: "faz o resumo",
  command: "",
  missedPolicy: "RUN_ON_BOOT"
};

// Cada comando sobe um tsx (~1,5 s); com a maquina ocupada o teste passa dos 5 s padrao do vitest.
describe("routines-cli", { timeout: 30_000 }, () => {
  it("cria com a validacao das rotas, resolve diretorio relativo a pasta mae e lista", () => {
    const add = cli("add", writeJson("script.json", scriptRoutine));
    expect(add.code, add.out).toBe(0);
    expect(add.out).toContain("criada #1: Fila do Instagram [SCRIPT]");
    expect(stored(1)?.directory).toBe(path.join(root, "projeto"));

    expect(cli("add", writeJson("agente.json", agentRoutine)).code).toBe(0);
    const list = cli("list");
    expect(list.out).toContain("Fila do Instagram");
    expect(list.out).toContain("a cada 15 min");
    expect(list.out).toContain("seg, às 09:00");

    const show = cli("show", "2");
    expect(show.out).toContain("prompt: faz o resumo");
    expect(show.out).toContain("modelo: claude-opus-5");

    const json = cli("list", "--json");
    const payload = JSON.parse(json.stdout) as { routines: { name: string; nextRunAt: number | null }[] };
    expect(payload.routines).toHaveLength(2);
    expect(payload.routines[0].nextRunAt).toBeTypeOf("number");
  });

  it("edit altera so o que veio no patch e trocar de executor limpa o que era do anterior", () => {
    cli("add", writeJson("agente.json", agentRoutine));
    const edit = cli("edit", "1", writeJson("patch.json", { time: "07:30", days: [1, 3, 5] }));
    expect(edit.code, edit.out).toBe(0);
    const afterEdit = stored(1);
    expect(afterEdit?.time).toBe("07:30");
    expect(afterEdit?.days).toEqual([1, 3, 5]);
    expect(afterEdit?.prompt).toBe("faz o resumo");
    expect(afterEdit?.model).toBe("claude-opus-5");
    expect(afterEdit?.timeoutMinutes).toBe(60);

    // Com --json sai so o JSON, senao o agente nao consegue ler o resultado da alteracao que ele fez.
    const asJson = cli("edit", "1", writeJson("json-patch.json", { timeoutMinutes: 90 }), "--json");
    expect(asJson.code, asJson.out).toBe(0);
    expect((JSON.parse(asJson.stdout) as { timeoutMinutes: number }).timeoutMinutes).toBe(90);

    const toScript = cli("edit", "1", writeJson("vira-script.json", { agentKind: "SCRIPT", command: "echo oi" }));
    expect(toScript.code, toScript.out).toBe(0);
    const afterKind = stored(1);
    expect(afterKind?.agentKind).toBe("SCRIPT");
    expect(afterKind?.command).toBe("echo oi");
    expect(afterKind?.prompt).toBe("");
    expect(afterKind?.model).toBeNull();
    expect(afterKind?.isFallbackEnabled).toBe(false);
  });

  it("recusa campo desconhecido, diretorio fora da pasta mae e rotina invalida, sem gravar nada", () => {
    cli("add", writeJson("agente.json", agentRoutine));

    const unknownField = cli("edit", "1", writeJson("errado.json", { nome: "outro" }));
    expect(unknownField.code).toBe(1);
    expect(unknownField.out).toContain("campo(s) que não existem na rotina: nome");

    const outside = cli("edit", "1", writeJson("fora.json", { directory: tmp }));
    expect(outside.code).toBe(1);
    expect(outside.out).toContain("fora da pasta mãe");

    const invalid = cli("edit", "1", writeJson("vazio.json", { prompt: "   " }));
    expect(invalid.code).toBe(1);
    expect(invalid.out).toContain("Escreva o prompt");

    const unchanged = stored(1);
    expect(unchanged?.name).toBe("Resumo do Google Ads");
    expect(unchanged?.directory).toBe(path.join(root, "projeto"));
    expect(unchanged?.prompt).toBe("faz o resumo");

    const missing = cli("show", "99");
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("rotina #99 não existe");
  });

  it("disable e enable ligam e desligam a mesma rotina", () => {
    cli("add", writeJson("script.json", scriptRoutine));
    expect(cli("disable", "1").out).toContain("desativada");
    expect(stored(1)?.isEnabled).toBe(false);
    expect(cli("enable", "1").out).toContain("ativa");
    expect(stored(1)?.isEnabled).toBe(true);
  });

  it("run-now enfileira uma execucao manual e recusa a segunda enquanto a primeira nao termina", () => {
    cli("add", writeJson("script.json", scriptRoutine));
    const first = cli("run-now", "1");
    expect(first.code, first.out).toBe(0);
    expect(first.out).toContain("execução #1 na fila");
    expect(first.out).toContain("o app não confere a fila desde nunca");

    const second = cli("run-now", "1");
    expect(second.code).toBe(1);
    expect(second.out).toContain("já tem uma execução na fila ou rodando");

    const runs = cli("runs", "1");
    expect(runs.out).toContain("#1");
    expect(runs.out).toContain("na fila");
    expect(runs.out).toContain("manual");
  });

  it("log mostra o fim do arquivo da execucao", () => {
    cli("add", writeJson("script.json", scriptRoutine));
    cli("run-now", "1");
    mkdirSync(path.join(dataDir, "logs"), { recursive: true });
    writeFileSync(path.join(dataDir, "logs", "1.log"), ["linha antiga", "linha do meio", "linha final"].join("\n"));

    const full = cli("log", "1");
    expect(full.code, full.out).toBe(0);
    expect(full.out).toContain("linha antiga");
    expect(full.out).toContain("linha final");

    const tail = cli("log", "1", "--tail", "1");
    expect(tail.out).toContain("linha final");
    expect(tail.out).not.toContain("linha antiga");
  });

  it("a referencia da skill documenta exatamente os campos que o CLI aceita", () => {
    const reference = readFileSync(
      path.join(projectDir, "skills", "claude-code", "skills", "syntax-routines", "references", "cli.md"),
      "utf8"
    );
    const section = reference.split("## O arquivo de uma rotina")[1]?.split("\n## ")[0] ?? "";
    const documented = [...section.matchAll(/^\| `([A-Za-z]+)` \|/gmu)].map((match) => match[1]);
    expect(documented.sort()).toEqual(Object.keys(routineSchema.shape).sort());
  });

  it("rm exige --forca e o banco nunca e criado por engano", () => {
    cli("add", writeJson("script.json", scriptRoutine));
    const refused = cli("rm", "1");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("--forca");
    expect(stored(1)).not.toBeNull();

    const removed = cli("rm", "1", "--forca");
    expect(removed.code, removed.out).toBe(0);
    expect(stored(1)).toBeNull();

    const other = path.join(tmp, "sem-banco");
    const missing = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", tsxCli, script, "list", "--data", other], {
      cwd: projectDir,
      encoding: "utf8",
      timeout: 60_000
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("banco não encontrado");
    expect(cli("settings").out).toContain("pasta mãe");
  });

  it("settings mostra o estado do envio de e-mail sem nenhum segredo", () => {
    const empty = cli("settings");
    expect(empty.code, empty.out).toBe(0);
    expect(empty.out).toContain("envio do aviso: não configurado");

    const db = openDb(path.join(dataDir, "app.db"));
    const panel = {
      smtp_host: "smtp.gmail.com",
      smtp_port: "587",
      smtp_user: "painel@example.com",
      mail_from_email: "painel@example.com",
      smtp_pass_dpapi: "c1f7ad0b10b"
    };
    for (const [key, value] of Object.entries(panel)) setSetting(db, key, value);
    const statusKey = "panel|smtp.gmail.com|587|false|painel@example.com|painel@example.com";
    setSetting(db, "mail_status", JSON.stringify({ key: statusKey, state: "failed", at: Date.now(), reason: "auth", detail: "535 5.7.8" }));
    writeSettings(db, { notifyEmail: "dono@example.com" });
    db.close();

    const text = cli("settings");
    expect(text.code, text.out).toBe(0);
    expect(text.out).toContain("envio do aviso: falhou (painel: painel@example.com via smtp.gmail.com:587;");
    expect(text.out).toContain("O servidor recusou o e-mail ou a senha.");
    const json = cli("settings", "--json");
    expect(json.code, json.out).toBe(0);
    expect(JSON.parse(json.stdout).mail).toMatchObject({ isConfigured: true, source: "panel", fromEmail: "painel@example.com", status: { state: "failed", reason: "auth" } });
    for (const out of [text.out, json.out]) expect(out).not.toContain("c1f7ad0b10b");
  });
});
