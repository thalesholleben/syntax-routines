import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildArgs, runAgent, runScript, type AgentRunInput, type ScriptRunInput } from "./runner";

let tmp = "";

function writeCmd(name: string, lines: string[]): string {
  const file = path.join(tmp, name);
  writeFileSync(file, `${lines.join("\r\n")}\r\n`);
  return file;
}

function runInput(bin: string, runId: number, overrides: Partial<AgentRunInput> = {}): AgentRunInput {
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

beforeAll(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-runner-")));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("buildArgs", () => {
  it("monta o Claude Code igual ao worker do Syntax Ops", () => {
    expect(buildArgs("CLAUDE", "C:\\p", "claude-opus-5", "high")).toEqual([
      "-p",
      "--model",
      "claude-opus-5",
      "--effort",
      "high",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--add-dir",
      "C:\\p"
    ]);
  });

  it("monta o Codex igual ao worker do Syntax Ops", () => {
    expect(buildArgs("CODEX", "C:\\p", null, "medium")).toEqual([
      "exec",
      "-c",
      "model_reasoning_effort=medium",
      "--json",
      "-C",
      "C:\\p",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-"
    ]);
  });
});

describe.runIf(process.platform === "win32")("runAgent", () => {
  it("manda o prompt pelo stdin, extrai o resultado do stream JSON e grava o log", async () => {
    const bin = writeCmd("fake-ok.cmd", ["@echo off", 'more > "%~dp0stdin.txt"', 'echo {"type":"result","result":"ok fake"}']);
    const outcome = await runAgent(runInput(bin, 1)).done;
    expect(outcome).toMatchObject({ code: 0, result: "ok fake", isTimedOut: false, isKilled: false, spawnError: null });
    expect(readFileSync(path.join(tmp, "stdin.txt"), "utf8")).toContain("linha 2");
    expect(readFileSync(path.join(tmp, "logs", "1.log"), "utf8")).toContain("=== tentativa 1");
  }, 20_000);

  it("codigo diferente de zero devolve o stderr", async () => {
    const bin = writeCmd("fake-fail.cmd", ["@echo off", "more > nul", "echo usage limit reached 1>&2", "exit /b 3"]);
    const outcome = await runAgent(runInput(bin, 2)).done;
    expect(outcome.code).toBe(3);
    expect(outcome.stderrTail).toContain("usage limit reached");
  }, 20_000);

  it("modelo invalido reexecuta sem --model", async () => {
    const bin = writeCmd("fake-model.cmd", [
      "@echo off",
      "more > nul",
      'echo %* | findstr /c:"--model" > nul',
      "if not errorlevel 1 (",
      "  echo invalid model 1>&2",
      "  exit /b 1",
      ")",
      'echo {"type":"result","result":"sem modelo"}'
    ]);
    const outcome = await runAgent(runInput(bin, 3, { model: "modelo-que-nao-existe" })).done;
    expect(outcome).toMatchObject({ code: 0, result: "sem modelo" });
  }, 20_000);

  it("timeout mata a arvore do processo", async () => {
    const bin = writeCmd("fake-slow.cmd", ["@echo off", "ping -n 30 127.0.0.1 > nul"]);
    const startedAt = Date.now();
    const outcome = await runAgent(runInput(bin, 4, { timeoutMs: 1500 })).done;
    expect(outcome.isTimedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
  }, 20_000);
});

describe.runIf(process.platform === "win32")("runScript", () => {
  function scriptInput(command: string, runId: number, overrides: Partial<ScriptRunInput> = {}): ScriptRunInput {
    return { runId, command, directory: tmp, timeoutMs: 20_000, logFile: path.join(tmp, "logs", `${runId}.log`), ...overrides };
  }

  it("roda a linha de comando no diretorio, devolve a cauda do stdout e grava o log", async () => {
    const outcome = await runScript(scriptInput("cmd /c echo rotina-script-ok && cd", 10)).done;
    expect(outcome).toMatchObject({ code: 0, isTimedOut: false, isKilled: false, spawnError: null });
    expect(outcome.result).toContain("rotina-script-ok");
    expect(outcome.result.toLowerCase()).toContain(tmp.toLowerCase());
    const log = readFileSync(path.join(tmp, "logs", "10.log"), "utf8");
    expect(log).toContain("=== script · cmd /c echo rotina-script-ok");
    expect(log).toContain("rotina-script-ok");
  }, 20_000);

  it("stdin fechado: script que le a entrada nao fica pendurado", async () => {
    const bin = writeCmd("le-stdin.cmd", ["@echo off", "more", "echo fim"]);
    const outcome = await runScript(scriptInput(`"${bin}"`, 11)).done;
    expect(outcome).toMatchObject({ code: 0, isTimedOut: false });
    expect(outcome.result).toContain("fim");
  }, 20_000);

  it("codigo diferente de zero devolve stdout e stderr", async () => {
    const outcome = await runScript(scriptInput("cmd /c echo ULTIMA-FALHA && echo deu ruim 1>&2 && exit /b 3", 12)).done;
    expect(outcome.code).toBe(3);
    expect(outcome.result).toContain("ULTIMA-FALHA");
    expect(outcome.stderrTail).toContain("deu ruim");
  }, 20_000);

  it("timeout mata a arvore do processo", async () => {
    const startedAt = Date.now();
    const outcome = await runScript(scriptInput("ping -n 30 127.0.0.1 > nul", 13, { timeoutMs: 1500 })).done;
    expect(outcome.isTimedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(15_000);
  }, 20_000);

  it("kill pelo usuario marca isKilled sem timeout", async () => {
    const handle = runScript(scriptInput("ping -n 30 127.0.0.1 > nul", 14));
    setTimeout(() => handle.kill(), 300);
    const outcome = await handle.done;
    expect(outcome).toMatchObject({ isKilled: true, isTimedOut: false });
  }, 20_000);
});
