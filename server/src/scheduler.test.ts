import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDb, type Db } from "./db";
import type { Mailer, MailMessage } from "./mailer";
import { purgeOldRuns, RETENTION_DAYS } from "./retention";
import { ConflictError, createRoutine, updateRoutine, type RoutineInput } from "./routines";
import type { AgentRunInput, AgentRunOutcome, RunAgent, RunScript, ScriptRunInput } from "./runner";
import { claimRun, createScheduler, NOTIFY_MAX_ATTEMPTS, NOTIFY_WINDOW_MS } from "./scheduler";
import { setMeta, writeSettings } from "./settings";

// Setembro de 2026 em horario local: o dia 14 e segunda-feira.
const at = (day: number, hours: number, minutes = 0, seconds = 0) => new Date(2026, 8, day, hours, minutes, seconds).getTime();
const MIN = 60_000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const flush = () => new Promise((resolve) => setImmediate(resolve));

interface FakeCall {
  input: AgentRunInput;
  isKilled: boolean;
  finish: (outcome?: Partial<AgentRunOutcome>) => void;
}

interface FakeScriptCall {
  input: ScriptRunInput;
  isKilled: boolean;
  finish: (outcome?: Partial<AgentRunOutcome>) => void;
}

/** Runner falso: registra cada chamada e deixa o teste decidir quando e como a execucao termina. */
function createFakeRunner() {
  const calls: FakeCall[] = [];
  const scriptCalls: FakeScriptCall[] = [];
  const runAgent: RunAgent = (input) => {
    let resolveDone: (outcome: AgentRunOutcome) => void = () => {};
    const done = new Promise<AgentRunOutcome>((resolve) => {
      resolveDone = resolve;
    });
    const call: FakeCall = {
      input,
      isKilled: false,
      finish: (outcome = {}) =>
        resolveDone({ code: 0, result: "ok", stderrTail: "", isTimedOut: false, isKilled: call.isKilled, spawnError: null, ...outcome })
    };
    calls.push(call);
    return {
      done,
      kill: () => {
        call.isKilled = true;
      }
    };
  };
  const runScript: RunScript = (input) => {
    let resolveDone: (outcome: AgentRunOutcome) => void = () => {};
    const done = new Promise<AgentRunOutcome>((resolve) => {
      resolveDone = resolve;
    });
    const call: FakeScriptCall = {
      input,
      isKilled: false,
      finish: (outcome = {}) =>
        resolveDone({ code: 0, result: "saida do script", stderrTail: "", isTimedOut: false, isKilled: call.isKilled, spawnError: null, ...outcome })
    };
    scriptCalls.push(call);
    return {
      done,
      kill: () => {
        call.isKilled = true;
      }
    };
  };
  return { calls, scriptCalls, runAgent, runScript };
}

/** Mailer falso: guarda o que enviaria e falha quando o teste manda. */
function createFakeMailer(isConfigured = true) {
  const sent: MailMessage[] = [];
  const state = { failNext: 0 };
  const mailer: Mailer = {
    isConfigured,
    async send(message) {
      if (state.failNext > 0) {
        state.failNext -= 1;
        throw new Error("SMTP recusou o envio: 535 auth failed");
      }
      sent.push(message);
    }
  };
  return { mailer, sent, state };
}

let tmp = "";
let root = "";
let dbFile = "";
let db: Db;
let clock = 0;
const extraDbs: Db[] = [];

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-scheduler-")));
  root = path.join(tmp, "root");
  mkdirSync(path.join(root, "projeto"), { recursive: true });
  dbFile = path.join(tmp, "app.db");
  db = openDb(dbFile);
  writeSettings(db, { rootDirectory: root, maxParallel: 2, bootDelayMinutes: 10 });
  clock = at(14, 8, 59, 40);
  setMeta(db, "last_tick_at", String(clock));
});

afterEach(() => {
  for (const extra of extraDbs.splice(0)) extra.close();
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function routineInput(overrides: Partial<RoutineInput> = {}): RoutineInput {
  return {
    name: "Resumo Google Ads",
    agentKind: "CLAUDE",
    directory: path.join(root, "projeto"),
    model: "claude-opus-5",
    effort: "high",
    timeoutMinutes: 30,
    isFallbackEnabled: false,
    days: [1],
    time: "09:00",
    intervalMinutes: null,
    prompt: "faz o resumo",
    command: null,
    missedPolicy: "SKIP",
    isEnabled: true,
    ...overrides
  };
}

function scriptInput(overrides: Partial<RoutineInput> = {}): RoutineInput {
  return routineInput({
    name: "Arquivar WhatsApp",
    agentKind: "SCRIPT",
    model: null,
    effort: "",
    prompt: "",
    command: "powershell -NoProfile -File arquivar.ps1",
    ...overrides
  });
}

function newScheduler(database: Db = db, options: { mailer?: Mailer } = {}) {
  const runner = createFakeRunner();
  const scheduler = createScheduler({
    db: database,
    runAgent: runner.runAgent,
    runScript: runner.runScript,
    logsDir: path.join(tmp, "logs"),
    now: () => clock,
    mailer: options.mailer,
    panelUrl: "http://127.0.0.1:4090/"
  });
  return { scheduler, calls: runner.calls, scriptCalls: runner.scriptCalls };
}

function runsOf(routineId: number) {
  return db
    .prepare(
      `SELECT id, trigger_type AS "triggerType", scheduled_for AS "scheduledFor", run_at AS "runAt", status,
        force_agent AS "forceAgent", agent_kind AS "agentKind", attempt, result, error, note
      FROM runs WHERE routine_id = ? ORDER BY scheduled_for, id`
    )
    .all(routineId);
}

function runningCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS "count" FROM runs WHERE status = 'RUNNING'`).get() as { count: number }).count;
}

function insertQueued(routineId: number, triggerType: "MANUAL" | "SCHEDULE", scheduledFor: number): number {
  const result = db
    .prepare(
      `INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, created_at) VALUES (?, ?, ?, ?, 'QUEUED', ?)`
    )
    .run(routineId, triggerType, scheduledFor, scheduledFor, scheduledFor);
  return Number(result.lastInsertRowid);
}

describe("tick", () => {
  it("roda a rotina no horario com os parametros dela e grava o sucesso", async () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.tick();

    expect(calls).toHaveLength(1);
    expect(calls[0].input).toMatchObject({
      agentKind: "CLAUDE",
      bin: "claude",
      directory: path.join(root, "projeto"),
      model: "claude-opus-5",
      effort: "high",
      prompt: "faz o resumo",
      timeoutMs: 30 * MIN,
      attempt: 1
    });
    expect(runsOf(id)).toMatchObject([{ triggerType: "SCHEDULE", scheduledFor: at(14, 9), status: "RUNNING", agentKind: "CLAUDE", attempt: 1 }]);

    calls[0].finish({ result: "resumo pronto" });
    await flush();
    expect(runsOf(id)).toMatchObject([{ status: "SUCCEEDED", result: "resumo pronto" }]);
  });

  it("replay da mesma janela depois de um crash nao duplica", async () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.tick();
    calls[0].finish();
    await flush();

    setMeta(db, "last_tick_at", String(at(14, 8, 59, 40)));
    clock = at(14, 9, 0, 40);
    scheduler.tick();

    expect(runsOf(id)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("dois schedulers em conexoes diferentes processando a mesma janela: uma linha, uma RUNNING e uma chamada", () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const second = openDb(dbFile);
    extraDbs.push(second);
    const first = newScheduler();
    const other = newScheduler(second);
    clock = at(14, 9, 0, 10);

    first.scheduler.tick();
    // o outro processo leu o last_tick_at antigo antes do commit do primeiro
    setMeta(db, "last_tick_at", String(at(14, 8, 59, 40)));
    other.scheduler.tick();

    expect(runsOf(id)).toHaveLength(1);
    expect(runningCount()).toBe(1);
    expect(first.calls.length + other.calls.length).toBe(1);
  });

  it("Promise.all de dois ticks na mesma instancia gera uma chamada", async () => {
    createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 9, 0, 10);
    await Promise.all([Promise.resolve().then(() => scheduler.tick()), Promise.resolve().then(() => scheduler.tick())]);
    expect(calls).toHaveLength(1);
  });

  it("primeira subida sem last_tick_at nao cria execucao do passado", () => {
    db.prepare("DELETE FROM meta").run();
    const id = createRoutine(db, routineInput({ days: EVERY_DAY, missedPolicy: "RUN_ON_BOOT" }), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 12);
    scheduler.tick();
    expect(runsOf(id)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("rotina salva depois do horario do dia nao dispara nesse dia", () => {
    const { scheduler, calls } = newScheduler();
    clock = at(14, 9, 0, 20);
    const id = createRoutine(db, routineInput(), at(14, 9, 0, 5));
    scheduler.tick();
    expect(runsOf(id)).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("PC desligado", () => {
  it("SKIP registra as tres perdidas como puladas e nao roda", () => {
    const id = createRoutine(db, routineInput({ days: EVERY_DAY }), at(1, 0));
    setMeta(db, "last_tick_at", String(at(11, 8)));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 8);
    scheduler.tick();
    expect(runsOf(id).map((run) => run.status)).toEqual(["SKIPPED", "SKIPPED", "SKIPPED"]);
    expect(calls).toHaveLength(0);
  });

  it("RUN_ON_BOOT pula as antigas e roda a mais recente depois do atraso", () => {
    const id = createRoutine(db, routineInput({ days: EVERY_DAY, missedPolicy: "RUN_ON_BOOT" }), at(1, 0));
    setMeta(db, "last_tick_at", String(at(11, 8)));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 8);
    scheduler.tick();
    expect(runsOf(id).map((run) => [run.scheduledFor, run.status, run.runAt])).toEqual([
      [at(11, 9), "SKIPPED", null],
      [at(12, 9), "SKIPPED", null],
      [at(13, 9), "QUEUED", at(14, 8, 10)]
    ]);

    clock = at(14, 8, 9);
    scheduler.tick();
    expect(calls).toHaveLength(0);

    clock = at(14, 8, 10);
    scheduler.tick();
    expect(calls).toHaveLength(1);
  });
});

describe("fila", () => {
  it("teto global: tres rotinas vencidas com max 2 iniciam duas e a terceira quando uma termina", async () => {
    for (const name of ["A", "B", "C"]) createRoutine(db, routineInput({ name }), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.tick();
    expect(calls).toHaveLength(2);
    expect(runningCount()).toBe(2);

    calls[0].finish();
    await flush();
    expect(calls).toHaveLength(3);
    expect(runningCount()).toBe(2);
  });

  it("executar agora com execucao ativa responde conflito", () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler } = newScheduler();
    scheduler.runNow(id);
    expect(() => scheduler.runNow(id)).toThrow(ConflictError);
  });

  it("tick no horario e executar agora no mesmo instante nunca rodam a mesma rotina em dobro", async () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.runNow(id);
    scheduler.tick();
    const statuses = () => runsOf(id).map((run) => [run.triggerType, run.status]);
    expect(calls).toHaveLength(1);
    expect(statuses()).toEqual([
      ["SCHEDULE", "QUEUED"],
      ["MANUAL", "RUNNING"]
    ]);

    calls[0].finish();
    await flush();
    expect(calls).toHaveLength(2);
    expect(statuses()).toEqual([
      ["SCHEDULE", "RUNNING"],
      ["MANUAL", "SUCCEEDED"]
    ]);
  });

  it("execucao agendada na fila de rotina desativada vira CANCELED e a manual roda", () => {
    const input = routineInput({ days: EVERY_DAY, missedPolicy: "RUN_ON_BOOT" });
    const id = createRoutine(db, input, at(1, 0));
    setMeta(db, "last_tick_at", String(at(13, 8)));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 8);
    scheduler.tick();
    expect(runsOf(id).map((run) => run.status)).toEqual(["QUEUED"]);

    updateRoutine(db, id, { ...input, isEnabled: false }, clock);
    clock = at(14, 8, 10);
    scheduler.tick();
    expect(runsOf(id).map((run) => run.status)).toEqual(["CANCELED"]);
    expect(calls).toHaveLength(0);

    scheduler.runNow(id);
    expect(calls).toHaveLength(1);
  });
});

describe("limite de uso e retry", () => {
  const limitError = { code: 1, result: "", stderrTail: "Claude AI usage limit reached, resets at 3pm" };

  it("sem fallback reagenda para o reset + 5 min no mesmo agente e persiste", async () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 10);
    scheduler.runNow(id);
    calls[0].finish(limitError);
    await flush();

    const reopened = new DatabaseSync(dbFile);
    const row = reopened
      .prepare(`SELECT status, run_at AS "runAt", attempt, force_agent AS "forceAgent" FROM runs WHERE routine_id = ?`)
      .get(id);
    reopened.close();
    expect(row).toEqual({ status: "QUEUED", runAt: at(14, 15, 5), attempt: 1, forceAgent: null });
    expect(calls).toHaveLength(1);
  });

  it("com fallback volta para a fila agora com o outro agente, modelo padrao e effort normalizado", async () => {
    const id = createRoutine(db, routineInput({ isFallbackEnabled: true, effort: "max" }), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 10);
    scheduler.runNow(id);
    expect(calls[0].input).toMatchObject({ agentKind: "CLAUDE", model: "claude-opus-5", effort: "max" });

    calls[0].finish(limitError);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].input).toMatchObject({ agentKind: "CODEX", bin: "codex", model: null, effort: "medium", attempt: 2 });
    const [run] = runsOf(id);
    expect(run).toMatchObject({ status: "RUNNING", agentKind: "CODEX", forceAgent: "CODEX", attempt: 2 });
    expect(String(run.note)).toContain("CLAUDE no limite de uso");
  });

  it("agente no limite conhecido: com fallback inicia no outro; sem fallback adia sem gastar tentativa", () => {
    const withFallback = createRoutine(db, routineInput({ name: "Com fallback", isFallbackEnabled: true }), at(1, 0));
    const withoutFallback = createRoutine(db, routineInput({ name: "Sem fallback" }), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 10);
    scheduler.limits.recordLimit("CLAUDE", new Date(at(14, 15)));

    scheduler.runNow(withFallback);
    expect(calls.map((call) => call.input.agentKind)).toEqual(["CODEX"]);

    scheduler.runNow(withoutFallback);
    expect(calls).toHaveLength(1);
    expect(runsOf(withoutFallback)).toMatchObject([{ status: "QUEUED", runAt: at(14, 15, 5), attempt: 0 }]);
  });

  it("terceira falha encerra como FAILED", async () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 10);
    scheduler.runNow(id);
    for (let attempt = 1; attempt <= 3; attempt++) {
      calls[attempt - 1].finish({ code: 1, result: "", stderrTail: "socket hang up" });
      await flush();
      clock += 2 * MIN; // passa do backoff (30 s e depois 60 s)
      scheduler.dispatch();
    }
    expect(calls).toHaveLength(3);
    expect(runsOf(id)).toMatchObject([{ status: "FAILED", attempt: 3 }]);
  });

  it("erro fatal falha na primeira tentativa", async () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 10);
    scheduler.runNow(id);
    calls[0].finish({ code: 1, result: "", stderrTail: "Error: not authenticated" });
    await flush();
    expect(runsOf(id)).toMatchObject([{ status: "FAILED", attempt: 1 }]);

    clock += 60 * MIN;
    scheduler.dispatch();
    expect(calls).toHaveLength(1);
  });
});

describe("recuperacao, cancelamento e pasta mae", () => {
  it("recoverOnBoot marca a execucao orfa como FAILED", () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    db.prepare(
      `INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, attempt, created_at) VALUES (?, 'MANUAL', ?, ?, 'RUNNING', 1, ?)`
    ).run(id, at(14, 7), at(14, 7), at(14, 7));
    const { scheduler } = newScheduler();
    expect(scheduler.recoverOnBoot()).toBe(1);
    expect(runsOf(id)).toMatchObject([{ status: "FAILED", error: "Interrompida: o app foi encerrado durante a execução." }]);
  });

  it("execucao na fila cancelada nunca roda", () => {
    const id = createRoutine(db, routineInput({ days: EVERY_DAY, missedPolicy: "RUN_ON_BOOT" }), at(1, 0));
    setMeta(db, "last_tick_at", String(at(13, 8)));
    const { scheduler, calls } = newScheduler();
    clock = at(14, 8);
    scheduler.tick();
    const [queued] = runsOf(id);
    scheduler.cancel(Number(queued.id));

    clock = at(14, 8, 10);
    scheduler.tick();
    expect(runsOf(id).map((run) => run.status)).toEqual(["CANCELED"]);
    expect(calls).toHaveLength(0);
  });

  it("execucao rodando cancelada chama kill e o termino nao sobrescreve", async () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const { scheduler, calls } = newScheduler();
    const runId = scheduler.runNow(id);
    scheduler.cancel(runId);
    expect(calls[0].isKilled).toBe(true);

    calls[0].finish({ code: 1, stderrTail: "processo encerrado" });
    await flush();
    expect(runsOf(id)).toMatchObject([{ status: "CANCELED" }]);
  });

  it("rotina fora da nova pasta mae falha sem executar", () => {
    const id = createRoutine(db, routineInput(), at(1, 0));
    const otherRoot = path.join(tmp, "outra-raiz");
    mkdirSync(otherRoot);
    writeSettings(db, { rootDirectory: otherRoot });
    const { scheduler, calls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.tick();
    expect(runsOf(id)).toMatchObject([{ status: "FAILED", error: "Diretório fora da pasta mãe." }]);
    expect(calls).toHaveLength(0);
  });
});

describe("claimRun", () => {
  const claim = (database: Db, id: number, maxParallel: number) =>
    claimRun(database, { id, agent: "CLAUDE", now: at(14, 9), maxParallel, note: null });

  it("max_parallel = 1 com duas conexoes: a segunda so ganha a vaga depois que a primeira libera", () => {
    const first = insertQueued(createRoutine(db, routineInput({ name: "A" }), at(1, 0)), "MANUAL", at(14, 9));
    const second = insertQueued(createRoutine(db, routineInput({ name: "B" }), at(1, 0)), "MANUAL", at(14, 9));
    const other = openDb(dbFile);
    extraDbs.push(other);

    expect(claim(db, first, 1)).toBe(true);
    expect(claim(other, second, 1)).toBe(false);
    db.prepare("UPDATE runs SET status = 'SUCCEEDED' WHERE id = ?").run(first);
    expect(claim(other, second, 1)).toBe(true);
  });

  it("mesma rotina nunca tem duas RUNNING, mesmo pela conexao de outro scheduler", () => {
    const routineId = createRoutine(db, routineInput(), at(1, 0));
    const manual = insertQueued(routineId, "MANUAL", at(14, 9));
    const scheduled = insertQueued(routineId, "SCHEDULE", at(14, 9, 1));
    const other = openDb(dbFile);
    extraDbs.push(other);

    expect(claim(db, manual, 5)).toBe(true);
    expect(claim(other, scheduled, 5)).toBe(false);
  });

  it("teto global disputado por duas conexoes nunca passa do limite", () => {
    const ids = ["A", "B", "C"].map((name) => insertQueued(createRoutine(db, routineInput({ name }), at(1, 0)), "MANUAL", at(14, 9)));
    const other = openDb(dbFile);
    extraDbs.push(other);

    expect([claim(db, ids[0], 2), claim(other, ids[1], 2), claim(other, ids[2], 2), claim(db, ids[2], 2)]).toEqual([true, true, false, false]);
    expect(runningCount()).toBe(2);
  });
});

describe("rotina de script", () => {
  it("roda pelo runner de script, sem modelo nem limite, e grava o sucesso com a saida", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    const { scheduler, calls, scriptCalls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.tick();

    expect(calls).toHaveLength(0);
    expect(scriptCalls).toHaveLength(1);
    expect(scriptCalls[0].input).toMatchObject({
      command: "powershell -NoProfile -File arquivar.ps1",
      directory: path.join(root, "projeto"),
      timeoutMs: 30 * MIN
    });
    expect(runsOf(id)).toMatchObject([{ status: "RUNNING", agentKind: "SCRIPT", attempt: 1 }]);

    scriptCalls[0].finish({ result: "3 conversas arquivadas" });
    await flush();
    expect(runsOf(id)).toMatchObject([{ status: "SUCCEEDED", result: "3 conversas arquivadas" }]);
  });

  it("codigo diferente de zero falha na primeira tentativa, sem retry", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    const { scheduler, scriptCalls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.tick();
    scriptCalls[0].finish({ code: 3, result: "ULTIMA-FALHA", stderrTail: "erro no arquivador" });
    await flush();

    const [run] = runsOf(id);
    expect(run).toMatchObject({ status: "FAILED", attempt: 1, agentKind: "SCRIPT" });
    expect(String(run.error)).toContain("código 3");
    expect(String(run.error)).toContain("erro no arquivador");
    clock = at(14, 9, 5);
    scheduler.dispatch();
    expect(scriptCalls).toHaveLength(1);
  });

  it("timeout e falha de spawn viram FAILED", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    const { scheduler, scriptCalls } = newScheduler();
    clock = at(14, 9, 0, 10);
    scheduler.tick();
    scriptCalls[0].finish({ code: null, isTimedOut: true, isKilled: true });
    await flush();
    expect(String(runsOf(id)[0].error)).toContain("Timeout após 30 min");

    const other = createRoutine(db, scriptInput({ name: "Outra", days: EVERY_DAY }), at(1, 0));
    scheduler.runNow(other);
    scriptCalls[1].finish({ code: null, spawnError: "ENOENT" });
    await flush();
    expect(String(runsOf(other)[0].error)).toContain("Falha ao iniciar o comando: ENOENT");
  });

  it("rotina por intervalo dispara so a ocorrencia mais recente e nunca gera pulada", () => {
    const id = createRoutine(db, scriptInput({ days: EVERY_DAY, intervalMinutes: 15, missedPolicy: "RUN_ON_BOOT" }), at(1, 0));
    // PC desligado das 08:59:40 as 13:31: as ocorrencias de 09:00 a 13:15 sao descartadas, 13:30 esta dentro da tolerancia.
    const { scheduler, scriptCalls } = newScheduler();
    clock = at(14, 13, 31);
    scheduler.tick();
    expect(runsOf(id)).toMatchObject([{ triggerType: "SCHEDULE", scheduledFor: at(14, 13, 30), status: "RUNNING" }]);
    expect(scriptCalls).toHaveLength(1);

    // Ocorrencia perdida alem da tolerancia nao deixa linha nenhuma.
    scriptCalls[0].finish();
    clock = at(14, 13, 50);
    scheduler.tick();
    expect(runsOf(id)).toHaveLength(1);
  });
});

describe("aviso por e-mail", () => {
  function failedRun(routineId: number, finishedAt: number, error = "explodiu"): number {
    const result = db
      .prepare(
        `INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, agent_kind, attempt, started_at, finished_at, exit_code, error, created_at)
        VALUES (?, 'SCHEDULE', ?, ?, 'FAILED', 'SCRIPT', 1, ?, ?, 3, ?, ?)`
      )
      .run(routineId, finishedAt - MIN, finishedAt - MIN, finishedAt - MIN, finishedAt, error, finishedAt - MIN);
    return Number(result.lastInsertRowid);
  }

  function notifyState(runId: number) {
    return db.prepare(`SELECT notified_at AS "notifiedAt", notify_attempts AS "notifyAttempts" FROM runs WHERE id = ?`).get(runId);
  }

  it("falha recente gera um e-mail com rotina, erro e link, e nao repete", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    writeSettings(db, { notifyEmail: "dono@example.com" });
    const fake = createFakeMailer();
    const { scheduler } = newScheduler(db, { mailer: fake.mailer });
    clock = at(14, 10);
    const runId = failedRun(id, at(14, 9, 30), "O comando encerrou com código 3.\nULTIMA-FALHA <script>");

    expect(await scheduler.notifyFailures()).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].to).toBe("dono@example.com");
    expect(fake.sent[0].subject).toBe("[Syntax Routines] Falhou: Arquivar WhatsApp");
    expect(fake.sent[0].text).toContain("Tipo: Script");
    expect(fake.sent[0].text).toContain("código 3");
    expect(fake.sent[0].text).toContain("http://127.0.0.1:4090/");
    expect(fake.sent[0].html).toContain("&lt;script&gt;");
    expect(notifyState(runId)).toEqual({ notifiedAt: at(14, 10), notifyAttempts: 0 });

    expect(await scheduler.notifyFailures()).toBe(0);
    expect(fake.sent).toHaveLength(1);
  });

  it("sem destinatario, sem SMTP, falha velha, sucesso ou pulada: nada e enviado", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    const fake = createFakeMailer();
    const { scheduler } = newScheduler(db, { mailer: fake.mailer });
    clock = at(14, 10);
    failedRun(id, at(14, 9));
    expect(await scheduler.notifyFailures()).toBe(0);

    writeSettings(db, { notifyEmail: "dono@example.com" });
    const semSmtp = createFakeMailer(false);
    expect(await newScheduler(db, { mailer: semSmtp.mailer }).scheduler.notifyFailures()).toBe(0);
    expect(semSmtp.sent).toHaveLength(0);

    // Agora com SMTP: a falha de 09:00 e avisada; a de ontem (fora das 24 h) e as nao-falhas nao.
    failedRun(id, at(14, 10) - NOTIFY_WINDOW_MS - MIN);
    db.prepare(
      `INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, finished_at, created_at) VALUES (?, 'SCHEDULE', ?, ?, 'SUCCEEDED', ?, ?)`
    ).run(id, at(14, 9, 45), at(14, 9, 45), at(14, 9, 46), at(14, 9, 45));
    db.prepare(`INSERT INTO runs (routine_id, trigger_type, scheduled_for, status, created_at) VALUES (?, 'SCHEDULE', ?, 'SKIPPED', ?)`).run(
      id,
      at(14, 9, 50),
      at(14, 9, 50)
    );
    expect(await scheduler.notifyFailures()).toBe(1);
    expect(fake.sent).toHaveLength(1);
  });

  it("envio recusado tenta de novo em n² minutos, sobrevive a horas sem internet e desiste no fim das 24 h", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    writeSettings(db, { notifyEmail: "dono@example.com" });
    const fake = createFakeMailer();
    const { scheduler } = newScheduler(db, { mailer: fake.mailer });
    clock = at(14, 10);
    const runId = failedRun(id, at(14, 10));

    fake.state.failNext = NOTIFY_MAX_ATTEMPTS;
    expect(await scheduler.notifyFailures()).toBe(0);
    expect(notifyState(runId)).toEqual({ notifiedAt: null, notifyAttempts: 1 });

    // Segunda tentativa so a partir de finished_at + 1 min.
    clock = at(14, 10, 0, 30);
    expect(await scheduler.notifyFailures()).toBe(0);
    expect(notifyState(runId)).toMatchObject({ notifyAttempts: 1 });
    clock = at(14, 11);
    expect(await scheduler.notifyFailures()).toBe(0);
    expect(notifyState(runId)).toMatchObject({ notifyAttempts: 2 });

    // Dai em diante, a tentativa n vem n² minutos depois da falha, ate a ultima ainda dentro das 24 h.
    for (let attempt = 2; attempt < NOTIFY_MAX_ATTEMPTS; attempt += 1) {
      clock = at(14, 10) + attempt * attempt * MIN - 1;
      expect(await scheduler.notifyFailures()).toBe(0);
      expect(notifyState(runId)).toMatchObject({ notifyAttempts: attempt });
      clock = at(14, 10) + attempt * attempt * MIN;
      expect(await scheduler.notifyFailures()).toBe(0);
      expect(notifyState(runId)).toMatchObject({ notifyAttempts: attempt + 1 });
    }
    expect(at(14, 10) + (NOTIFY_MAX_ATTEMPTS - 1) ** 2 * MIN).toBeLessThan(at(14, 10) + NOTIFY_WINDOW_MS);
    clock = at(14, 10) + NOTIFY_WINDOW_MS + MIN;
    expect(await scheduler.notifyFailures()).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it("aviso preso por uma queda de internet de 4 h sai quando a conexao volta", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    writeSettings(db, { notifyEmail: "dono@example.com" });
    const fake = createFakeMailer();
    const { scheduler } = newScheduler(db, { mailer: fake.mailer });
    const runId = failedRun(id, at(14, 10));

    // Falha as 10:00 e sem internet ate 14:00: as 16 tentativas desse periodo (0, 1, 4, ... 225 min) falham.
    fake.state.failNext = 16;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      clock = at(14, 10) + attempt * attempt * MIN;
      expect(await scheduler.notifyFailures()).toBe(0);
    }
    expect(notifyState(runId)).toMatchObject({ notifiedAt: null, notifyAttempts: 16 });

    // A 17ª cai as 14:16, ja com internet: o aviso sai e nao repete.
    clock = at(14, 10) + 256 * MIN;
    expect(await scheduler.notifyFailures()).toBe(1);
    expect(fake.sent).toHaveLength(1);
    expect(notifyState(runId)).toMatchObject({ notifiedAt: clock, notifyAttempts: 16 });
    clock = at(14, 10) + 289 * MIN;
    expect(await scheduler.notifyFailures()).toBe(0);
    expect(fake.sent).toHaveLength(1);
  });

  it("o tick avisa a falha que o proprio tick produziu (diretorio fora da pasta mae)", async () => {
    const id = createRoutine(db, scriptInput(), at(1, 0));
    writeSettings(db, { notifyEmail: "dono@example.com", rootDirectory: path.join(tmp, "outra-raiz") });
    mkdirSync(path.join(tmp, "outra-raiz"));
    const fake = createFakeMailer();
    const { scheduler } = newScheduler(db, { mailer: fake.mailer });
    clock = at(14, 9, 0, 10);
    scheduler.tick();
    await flush();
    expect(runsOf(id)).toMatchObject([{ status: "FAILED", error: "Diretório fora da pasta mãe." }]);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].text).toContain("Diretório fora da pasta mãe.");
  });
});

describe("retencao", () => {
  const DAY = 24 * 60 * MIN;

  function finishedRun(routineId: number, finishedAt: number, status = "SUCCEEDED"): number {
    const result = db
      .prepare(`INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, finished_at, created_at) VALUES (?, 'MANUAL', ?, ?, ?, ?, ?)`)
      .run(routineId, finishedAt, finishedAt, status, finishedAt, finishedAt);
    const id = Number(result.lastInsertRowid);
    mkdirSync(path.join(tmp, "logs"), { recursive: true });
    writeFileSync(path.join(tmp, "logs", `${id}.log`), "log");
    return id;
  }

  it("apaga so as terminadas velhas, com o log, e preserva a ultima de cada rotina", () => {
    const a = createRoutine(db, scriptInput({ name: "A" }), at(1, 0));
    const b = createRoutine(db, scriptInput({ name: "B" }), at(1, 0));
    const now = at(14, 10);
    const old1 = finishedRun(a, now - (RETENTION_DAYS + 5) * DAY);
    const old2 = finishedRun(a, now - (RETENTION_DAYS + 2) * DAY, "FAILED");
    const recent = finishedRun(a, now - 2 * DAY);
    const onlyOld = finishedRun(b, now - (RETENTION_DAYS + 9) * DAY);
    const queued = insertQueued(b, "MANUAL", now - (RETENTION_DAYS + 9) * DAY);
    // Pulada velha sem finished_at conta pelo created_at.
    db.prepare(`INSERT INTO runs (routine_id, trigger_type, scheduled_for, status, created_at) VALUES (?, 'SCHEDULE', ?, 'SKIPPED', ?)`).run(
      a,
      now - 40 * DAY,
      now - 40 * DAY
    );

    expect(purgeOldRuns(db, path.join(tmp, "logs"), now)).toBe(3);
    const remaining = (db.prepare("SELECT id FROM runs ORDER BY id").all() as { id: number }[]).map((row) => row.id);
    expect(remaining).toEqual([recent, onlyOld, queued]);
    expect(existsSync(path.join(tmp, "logs", `${old1}.log`))).toBe(false);
    expect(existsSync(path.join(tmp, "logs", `${old2}.log`))).toBe(false);
    expect(existsSync(path.join(tmp, "logs", `${recent}.log`))).toBe(true);
    expect(existsSync(path.join(tmp, "logs", `${onlyOld}.log`))).toBe(true);
  });

  it("o tick purga uma vez por hora", () => {
    // Rotina pausada: o tick nao materializa ocorrencia, so a retencao mexe na tabela.
    const a = createRoutine(db, scriptInput({ name: "A", isEnabled: false }), at(1, 0));
    const now = at(14, 10);
    finishedRun(a, now - 40 * DAY);
    finishedRun(a, now - 39 * DAY);
    finishedRun(a, now - DAY);
    const { scheduler } = newScheduler();
    clock = now;
    scheduler.tick();
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 1 });

    finishedRun(a, now - 38 * DAY);
    clock = now + 30 * MIN;
    scheduler.tick();
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 2 });
    clock = now + 61 * MIN;
    scheduler.tick();
    expect(db.prepare("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 1 });
  });
});
