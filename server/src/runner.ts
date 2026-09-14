import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";

import type { AgentKind } from "./agents";

export interface AgentRunInput {
  runId: number;
  agentKind: AgentKind;
  bin: string;
  directory: string;
  model: string | null;
  effort: string;
  prompt: string;
  timeoutMs: number;
  logFile: string;
  attempt: number;
}

/** Rotina de script: a linha de comando inteira, como seria digitada no cmd, rodando no diretorio da rotina. */
export interface ScriptRunInput {
  runId: number;
  command: string;
  directory: string;
  timeoutMs: number;
  logFile: string;
}

export interface AgentRunOutcome {
  code: number | null;
  result: string;
  stderrTail: string;
  isTimedOut: boolean;
  isKilled: boolean;
  spawnError: string | null;
}

export interface AgentRunHandle {
  done: Promise<AgentRunOutcome>;
  kill: () => void;
}

export type RunAgent = (input: AgentRunInput) => AgentRunHandle;
export type RunScript = (input: ScriptRunInput) => AgentRunHandle;

const isWindows = process.platform === "win32";
const TAIL_MAX_CHARS = 20_000;

const MODEL_ERROR_PATTERNS = [
  /unknown model/i,
  /invalid model/i,
  /model not found/i,
  /unrecognized model/i,
  /no such model/i,
  /model.*not.*supported/i,
  /unsupported.*model/i
];

export function isModelError(text: string): boolean {
  return MODEL_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Mesmos comandos do worker do Syntax Ops, sem prompt de permissao e com o prompt sempre pelo STDIN:
 *   claude -p [--model M] [--effort E] --output-format stream-json --verbose --dangerously-skip-permissions --add-dir <dir>
 *   codex exec [--model M] [-c model_reasoning_effort=E] --json -C <dir> --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -
 */
export function buildArgs(agentKind: AgentKind, directory: string, model: string | null, effort: string): string[] {
  if (agentKind === "CLAUDE") {
    const args = ["-p"];
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
    args.push("--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--add-dir", directory);
    return args;
  }
  const args = ["exec"];
  if (model) args.push("--model", model);
  if (effort) args.push("-c", `model_reasoning_effort=${effort}`);
  args.push("--json", "-C", directory, "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "-");
  return args;
}

/** Extrai o texto de resultado de uma linha stream-json do Claude, se houver. */
export function parseClaudeResultLine(line: string): string | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    if (obj.type === "result" && typeof obj.result === "string") return obj.result;
    if (obj.type === "assistant" && obj.message && typeof obj.message === "object") {
      const message = obj.message as { content?: unknown };
      if (Array.isArray(message.content)) {
        const text = message.content
          .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : ""))
          .join("");
        return text || null;
      }
    }
  } catch {
    /* nao e JSON */
  }
  return null;
}

/** Extrai o texto de resultado de uma linha JSON do Codex, se houver. */
export function parseCodexResultLine(line: string): string | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";
    // Formato atual: {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
    const item = obj.item as { type?: unknown; text?: unknown } | undefined;
    if (item && item.type === "agent_message" && typeof item.text === "string") {
      return item.text;
    }
    if (type.includes("message") || type.includes("agent")) {
      if (typeof obj.text === "string") return obj.text;
      const message = obj.message as { content?: unknown; text?: unknown } | undefined;
      if (message && typeof message.text === "string") return message.text;
      if (message && Array.isArray(message.content)) {
        return message.content
          .map((block) => (block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : ""))
          .join("");
      }
    }
  } catch {
    /* nao e JSON */
  }
  return null;
}

function winQuote(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Remove marcadores de sessao Claude Code herdados (CLAUDECODE, CLAUDE_CODE_*, CLAUDE_AGENT_SDK_*): sem isso o
 * `claude` recusa por deteccao de sessao aninhada quando o app sobe de dentro de um Claude Code.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^CLAUDECODE$|^CLAUDE_CODE|^CLAUDE_AGENT_SDK/i.test(key)) delete env[key];
  }
  return env;
}

function killTree(child: ChildProcess): void {
  try {
    if (isWindows && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    } else {
      child.kill("SIGKILL");
    }
  } catch {
    child.kill("SIGKILL");
  }
}

function openLog(logFile: string): WriteStream {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const logStream = createWriteStream(logFile, { flags: "a" });
  logStream.on("error", () => {
    /* log da execucao nao pode derrubar o app */
  });
  return logStream;
}

interface ExecuteOptions {
  /** Linha de comando inteira (Windows, via cmd) ou binario + args (demais plataformas; `useShell` = linha inteira via sh). */
  windowsCommandLine: string;
  posix: { bin: string; args: string[]; useShell: boolean };
  cwd: string;
  /** Texto para o stdin; null fecha o stdin sem escrever. */
  stdin: string | null;
  timeoutMs: number;
  logStream: WriteStream;
  /** Extrai o resultado final de cada linha do stdout; sem parser, o resultado e a cauda do stdout. */
  parse: ((line: string) => string | null) | null;
}

interface ExecuteState {
  current: ChildProcess | null;
  isKilled: boolean;
}

/** Roda um processo filho ate o fim (ou timeout), gravando stdout/stderr no log. Nunca rejeita. */
function execute(options: ExecuteOptions, state: ExecuteState): Promise<AgentRunOutcome> {
  return new Promise<AgentRunOutcome>((resolve) => {
    const env = buildChildEnv();
    // No Windows as CLIs sao shims .cmd e exigem shell; a linha unica ja citada evita o aviso DEP0190.
    const child = isWindows
      ? spawn(options.windowsCommandLine, { cwd: options.cwd, env, windowsHide: true, shell: true })
      : spawn(options.posix.bin, options.posix.args, { cwd: options.cwd, env, shell: options.posix.useShell });
    state.current = child;

    let stdoutPartial = "";
    let stdoutTail = "";
    let stderrTail = "";
    let lastResult = "";
    let isTimedOut = false;
    let isSettled = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      options.logStream.write(chunk);
      stdoutTail = (stdoutTail + chunk).slice(-TAIL_MAX_CHARS);
      if (!options.parse) return;
      const lines = (stdoutPartial + chunk).split(/\r?\n/);
      stdoutPartial = lines.pop() ?? "";
      for (const line of lines) {
        const parsed = line.trim() ? options.parse(line) : null;
        if (parsed) lastResult = parsed;
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      options.logStream.write(chunk);
      stderrTail = (stderrTail + chunk).slice(-TAIL_MAX_CHARS);
    });

    // O CLI pode fechar o stdin antes de ler tudo (EPIPE); o desfecho vem pelo codigo de saida.
    child.stdin?.on("error", () => {});
    if (options.stdin === null) child.stdin?.end();
    else child.stdin?.end(options.stdin);

    const timer =
      options.timeoutMs > 0
        ? setTimeout(() => {
            isTimedOut = true;
            killTree(child);
          }, options.timeoutMs)
        : null;

    const settle = (code: number | null, spawnError: string | null) => {
      if (isSettled) return;
      isSettled = true;
      if (timer) clearTimeout(timer);
      const parsed = options.parse && stdoutPartial.trim() ? options.parse(stdoutPartial) : null;
      if (parsed) lastResult = parsed;
      resolve({ code, result: (lastResult || stdoutTail).trim(), stderrTail, isTimedOut, isKilled: state.isKilled, spawnError });
    };
    child.on("error", (error) => settle(null, error.message));
    child.on("close", (code) => settle(code, null));
  });
}

function closeLog(logStream: WriteStream): Promise<void> {
  return new Promise<void>((resolve) => logStream.end(() => resolve()));
}

export const runAgent: RunAgent = (input) => {
  const logStream = openLog(input.logFile);
  const state: ExecuteState = { current: null, isKilled: false };
  const parse = input.agentKind === "CLAUDE" ? parseClaudeResultLine : parseCodexResultLine;

  const runOnce = (model: string | null) => {
    const args = buildArgs(input.agentKind, input.directory, model, input.effort);
    const header = [`tentativa ${input.attempt}`, input.agentKind, model ?? "modelo padrão do CLI", `effort ${input.effort}`];
    logStream.write(`\n=== ${header.join(" · ")} · ${new Date().toISOString()} ===\n`);
    return execute(
      {
        windowsCommandLine: [input.bin, ...args].map(winQuote).join(" "),
        posix: { bin: input.bin, args, useShell: false },
        cwd: input.directory,
        stdin: input.prompt,
        timeoutMs: input.timeoutMs,
        logStream,
        parse
      },
      state
    );
  };

  const done = (async () => {
    let outcome = await runOnce(input.model);
    const isInvalidModel =
      outcome.code !== 0 &&
      !outcome.isTimedOut &&
      !outcome.isKilled &&
      input.model !== null &&
      isModelError(`${outcome.stderrTail}\n${outcome.result}`);
    if (isInvalidModel) {
      logStream.write(`\n[Modelo "${input.model}" inválido; reexecutando com o modelo padrão do CLI.]\n`);
      outcome = await runOnce(null);
    }
    await closeLog(logStream);
    return outcome;
  })();

  return {
    done,
    kill: () => {
      state.isKilled = true;
      if (state.current) killTree(state.current);
    }
  };
};

/**
 * Rotina de script: o comando vai inteiro para o shell (cmd no Windows, sh nos demais), no diretorio da rotina, com
 * stdin fechado e sem janela. O resultado e a cauda do stdout; quem decide sucesso e o codigo de saida.
 */
export const runScript: RunScript = (input) => {
  const logStream = openLog(input.logFile);
  const state: ExecuteState = { current: null, isKilled: false };
  logStream.write(`\n=== script · ${input.command} · ${new Date().toISOString()} ===\n`);

  const done = (async () => {
    const outcome = await execute(
      {
        windowsCommandLine: input.command,
        posix: { bin: input.command, args: [], useShell: true },
        cwd: input.directory,
        stdin: null,
        timeoutMs: input.timeoutMs,
        logStream,
        parse: null
      },
      state
    );
    await closeLog(logStream);
    return outcome;
  })();

  return {
    done,
    kill: () => {
      state.isKilled = true;
      if (state.current) killTree(state.current);
    }
  };
};
