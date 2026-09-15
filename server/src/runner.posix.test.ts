// Runner no macOS e no Linux, com processos de verdade: scripts sh no lugar dos CLIs e comandos reais pelo /bin/sh.
// Espelha os testes de Windows de runner.test.ts e acrescenta o que so da para provar aqui: timeout e cancelar
// matam tambem o NETO (o comando que o shell do script abriu, o subprocesso do agente), nao so o filho.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAgent, runScript, type AgentRunInput, type ScriptRunInput } from "./runner";

let tmp = "";

beforeAll(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-runner-posix-")));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeSh(name: string, body: string[]): string {
  const file = path.join(tmp, name);
  writeFileSync(file, ["#!/bin/sh", ...body, ""].join("\n"));
  chmodSync(file, 0o755);
  return file;
}

function agentInput(bin: string, runId: number, overrides: Partial<AgentRunInput> = {}): AgentRunInput {
  return {
    runId,
    agentKind: "CLAUDE",
    bin,
    directory: tmp,
    model: null,
    effort: "high",
    prompt: "linha 1\nlinha 2",
    timeoutMs: 20_000,
    logFile: path.join(tmp, "logs", `${runId}.log`),
    attempt: 1,
    ...overrides
  };
}

function scriptInput(command: string, runId: number, overrides: Partial<ScriptRunInput> = {}): ScriptRunInput {
  return { runId, command, directory: tmp, timeoutMs: 20_000, logFile: path.join(tmp, "logs", `${runId}.log`), ...overrides };
}

/**
 * O processo ainda executa? Morto que o pai ainda nao colheu (zumbi, estado Z) conta como morto: num container sem
 * init o neto orfao fica Z para sempre e nunca da ESRCH, sem estar rodando nada.
 */
function isExecuting(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const state =
      process.platform === "linux"
        ? (readFileSync(`/proc/${pid}/stat`, "utf8").split(") ").pop() ?? "").trim().charAt(0)
        : spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).stdout.trim().charAt(0);
    return state !== "" && state !== "Z";
  } catch {
    return false;
  }
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return condition();
}

/** Le o PID que o script gravou, esperando o arquivo aparecer. */
async function readPid(file: string): Promise<number> {
  expect(await waitFor(() => existsSync(file) && readFileSync(file, "utf8").trim() !== "")).toBe(true);
  return Number(readFileSync(file, "utf8").trim());
}

describe.runIf(process.platform !== "win32")("runAgent no macOS e no Linux", () => {
  it("manda o prompt pelo stdin, extrai o resultado do stream JSON e grava o log", async () => {
    const bin = writeSh("fake-ok.sh", [`cat > "${path.join(tmp, "stdin.txt")}"`, `echo '{"type":"result","result":"ok fake"}'`]);
    const outcome = await runAgent(agentInput(bin, 1)).done;
    expect(outcome).toMatchObject({ code: 0, result: "ok fake", isTimedOut: false, isKilled: false, spawnError: null });
    expect(readFileSync(path.join(tmp, "stdin.txt"), "utf8")).toContain("linha 2");
    expect(readFileSync(path.join(tmp, "logs", "1.log"), "utf8")).toContain("=== tentativa 1");
  }, 20_000);

  it("codigo diferente de zero devolve o stderr", async () => {
    const bin = writeSh("fake-fail.sh", ["cat > /dev/null", 'echo "usage limit reached" 1>&2', "exit 3"]);
    const outcome = await runAgent(agentInput(bin, 2)).done;
    expect(outcome.code).toBe(3);
    expect(outcome.stderrTail).toContain("usage limit reached");
  }, 20_000);

  it("modelo invalido reexecuta sem --model", async () => {
    const bin = writeSh("fake-model.sh", [
      "cat > /dev/null",
      'case " $* " in',
      '  *" --model "*) echo "invalid model" 1>&2; exit 1 ;;',
      "esac",
      `echo '{"type":"result","result":"sem modelo"}'`
    ]);
    const outcome = await runAgent(agentInput(bin, 3, { model: "modelo-que-nao-existe" })).done;
    expect(outcome).toMatchObject({ code: 0, result: "sem modelo" });
  }, 20_000);

  it("binario inexistente vira spawnError, sem derrubar nada", async () => {
    const outcome = await runAgent(agentInput(path.join(tmp, "nao-existe"), 4)).done;
    expect(outcome.code).toBeNull();
    expect(outcome.spawnError).toContain("ENOENT");
  }, 20_000);

  it("timeout mata o agente e o subprocesso que ele abriu", async () => {
    const pidFile = path.join(tmp, "agente-neto.pid");
    const bin = writeSh("fake-slow.sh", ["cat > /dev/null", "sleep 30 &", `echo $! > "${pidFile}"`, "wait"]);
    const startedAt = Date.now();
    const outcome = await runAgent(agentInput(bin, 5, { timeoutMs: 1500 })).done;
    expect(outcome.isTimedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    const grandchild = await readPid(pidFile);
    expect(await waitFor(() => !isExecuting(grandchild))).toBe(true);
  }, 20_000);
});

describe.runIf(process.platform !== "win32")("runScript no macOS e no Linux", () => {
  it("roda a linha de comando no diretorio pelo sh, devolve a cauda do stdout e grava o log", async () => {
    const outcome = await runScript(scriptInput("echo rotina-script-ok && pwd", 10)).done;
    expect(outcome).toMatchObject({ code: 0, isTimedOut: false, isKilled: false, spawnError: null });
    expect(outcome.result).toContain("rotina-script-ok");
    expect(outcome.result).toContain(tmp);
    const log = readFileSync(path.join(tmp, "logs", "10.log"), "utf8");
    expect(log).toContain("=== script · echo rotina-script-ok");
    expect(log).toContain("rotina-script-ok");
  }, 20_000);

  it("stdin fechado: script que le a entrada nao fica pendurado", async () => {
    const outcome = await runScript(scriptInput("cat; echo fim", 11)).done;
    expect(outcome).toMatchObject({ code: 0, isTimedOut: false });
    expect(outcome.result).toContain("fim");
  }, 20_000);

  it("codigo diferente de zero devolve stdout e stderr", async () => {
    const outcome = await runScript(scriptInput("echo ULTIMA-FALHA && echo deu ruim 1>&2 && exit 3", 12)).done;
    expect(outcome.code).toBe(3);
    expect(outcome.result).toContain("ULTIMA-FALHA");
    expect(outcome.stderrTail).toContain("deu ruim");
  }, 20_000);

  it("timeout mata o shell e o comando que ele abriu", async () => {
    const pidFile = path.join(tmp, "script-neto-timeout.pid");
    const startedAt = Date.now();
    const outcome = await runScript(scriptInput(`sleep 30 & echo $! > "${pidFile}"; wait`, 13, { timeoutMs: 1500 })).done;
    expect(outcome.isTimedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    const grandchild = await readPid(pidFile);
    expect(await waitFor(() => !isExecuting(grandchild))).toBe(true);
  }, 20_000);

  it("cancelar pelo usuario marca isKilled e mata o comando que o shell abriu", async () => {
    const pidFile = path.join(tmp, "script-neto-kill.pid");
    const handle = runScript(scriptInput(`sleep 30 & echo $! > "${pidFile}"; wait`, 14));
    const grandchild = await readPid(pidFile);
    expect(isExecuting(grandchild)).toBe(true);
    handle.kill();
    const outcome = await handle.done;
    expect(outcome).toMatchObject({ isKilled: true, isTimedOut: false });
    expect(await waitFor(() => !isExecuting(grandchild))).toBe(true);
  }, 20_000);
});
