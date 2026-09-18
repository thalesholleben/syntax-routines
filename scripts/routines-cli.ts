// CLI do Syntax Routines: le e manipula as rotinas sem abrir o painel e sem a senha dele (o dono do PC ja
// provou quem e ao ter acesso a pasta). Existe para um agente de codigo operar o app, e usa as MESMAS funcoes
// do servidor: validacao (`routineSchema`), pasta (`checkDirectory`), escrita (`createRoutine`/`updateRoutine`)
// e fila (`enqueueManualRun`). Nao ha regra de negocio aqui.
//
//   node dist/routines.mjs list                 (instalado)
//   npm run routines -- list                    (desenvolvimento)
//
// Quem executa continua sendo o app: `run-now` poe na fila e o agendador despacha no proximo tick (30 s).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMMAND_MAX_CHARS,
  EFFORTS_BY_KIND,
  EXECUTOR_KINDS,
  INTERVAL_OPTIONS_MINUTES,
  MODELS_BY_KIND,
  TIMEOUT_OPTIONS_MINUTES
} from "../server/src/agents";
import { openDb, type Db } from "../server/src/db";
import { describeMail, type MailView } from "../server/src/mailer";
import {
  ConflictError,
  createRoutine,
  deleteRoutine,
  enqueueManualRun,
  getRoutine,
  getRun,
  listRoutines,
  listRuns,
  NotFoundError,
  setRoutineEnabled,
  toRoutineFields,
  updateRoutine,
  type RoutineRow,
  type RoutineView,
  type RunRow,
  type RunStatus
} from "../server/src/routines";
import { readLogTail, routineSchema } from "../server/src/routes";
import { getMeta, readSettings } from "../server/src/settings";
import { prepareRoutine } from "./routine-input";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TICK_STALE_MS = 3 * 60_000;
const DEFAULT_RUNS_LIMIT = 20;
const DEFAULT_LOG_LINES = 40;

/**
 * Campos aceitos em `add` e `edit`, tirados do proprio schema das rotas: campo novo na rotina aparece aqui
 * sozinho. Chave fora da lista e erro, nao e ignorada em silencio (o agente precisa saber que nao pegou).
 */
const PAYLOAD_FIELDS = Object.keys(routineSchema.shape);

const STATUS_TEXT: Record<RunStatus, string> = {
  QUEUED: "na fila",
  RUNNING: "rodando",
  SUCCEEDED: "concluída",
  FAILED: "falhou",
  SKIPPED: "pulada",
  CANCELED: "cancelada"
};
const DAY_NAMES = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

class CliError extends Error {}

function fail(message: string): never {
  throw new CliError(message);
}

// ---------------------------------------------------------------- formatação

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** "hoje 14:45", "amanhã 09:00" ou "16/09 09:00". */
function when(ms: number | null): string {
  if (ms === null) return "";
  const date = new Date(ms);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((date.getTime() - midnight.getTime()) / 86_400_000);
  if (days === 0) return `hoje ${clock(ms)}`;
  if (days === 1) return `amanhã ${clock(ms)}`;
  if (days === -1) return `ontem ${clock(ms)}`;
  return `${date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${clock(ms)}`;
}

function minutesText(minutes: number): string {
  return minutes % 60 === 0 && minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`;
}

function daysText(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "todos os dias";
  if (sorted.join() === "1,2,3,4,5") return "seg a sex";
  if (sorted.join() === "0,6") return "sáb e dom";
  return sorted.map((day) => DAY_NAMES[day]).join(", ");
}

function scheduleText(routine: { days: number[]; time: string; intervalMinutes: number | null }): string {
  const grade = routine.intervalMinutes === null ? `às ${routine.time}` : `a cada ${minutesText(routine.intervalMinutes)}`;
  return `${daysText(routine.days)}, ${grade}`;
}

function runText(run: RunRow | null): string {
  if (!run) return "nunca rodou";
  const at = run.finishedAt ?? run.startedAt ?? run.runAt ?? run.scheduledFor;
  return `${STATUS_TEXT[run.status]} ${when(at)}`;
}

function durationText(run: RunRow): string {
  if (run.startedAt === null || run.finishedAt === null) return "";
  const seconds = Math.round((run.finishedAt - run.startedAt) / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

function pad(value: string, size: number): string {
  return value.length > size ? `${value.slice(0, size - 1)}…` : value.padEnd(size);
}

// ---------------------------------------------------------------- contexto

interface Options {
  json: boolean;
  limit: number | null;
  tail: number | null;
  force: boolean;
}

interface Ctx {
  db: Db;
  now: number;
  options: Options;
  dbFile: string;
}

function parseNumber(label: string, raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) fail(`${label} inválido: use um número inteiro positivo.`);
  return value;
}

function requireRoutine(ctx: Ctx, raw: string | undefined): RoutineRow {
  const id = parseNumber("id da rotina", raw);
  const routine = getRoutine(ctx.db, id);
  if (!routine) fail(`rotina #${id} não existe. Veja \`list\`.`);
  return routine;
}

function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail(`JSON inválido em ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJsonFile(file: string | undefined, label: string): Record<string, unknown> {
  if (!file) fail(`falta o arquivo ${label}.`);
  const full = path.resolve(file);
  if (!existsSync(full)) fail(`arquivo não encontrado: ${full}`);
  const parsed = parseJson(readFileSync(full, "utf8"), full);
  if (Array.isArray(parsed)) fail("um arquivo por rotina aqui; para uma lista use `npm run import -- <arquivo>`.");
  if (typeof parsed !== "object" || parsed === null) fail("o arquivo precisa ter um objeto JSON com os campos da rotina.");
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.routines)) fail("um arquivo por rotina aqui; para uma lista use `npm run import -- <arquivo>`.");
  const unknownKeys = Object.keys(record).filter((key) => !PAYLOAD_FIELDS.includes(key));
  if (unknownKeys.length > 0) {
    fail(`campo(s) que não existem na rotina: ${unknownKeys.join(", ")}. Aceitos: ${PAYLOAD_FIELDS.join(", ")}.`);
  }
  return record;
}

function requireRoot(ctx: Ctx): string {
  const { rootDirectory } = readSettings(ctx.db);
  if (!rootDirectory) fail("defina a pasta mãe em Ajustes antes de criar ou alterar rotinas.");
  return rootDirectory;
}

/** Rotina do banco no formato do arquivo de entrada, para o `edit` aplicar o patch por cima. */
function toPayload(row: RoutineRow): Record<string, unknown> {
  const fields = toRoutineFields(row);
  return {
    name: fields.name,
    agentKind: fields.agentKind,
    directory: fields.directory,
    model: fields.model,
    effort: fields.effort,
    timeoutMinutes: fields.timeoutMinutes,
    isFallbackEnabled: fields.isFallbackEnabled,
    days: fields.days,
    time: fields.time,
    intervalMinutes: fields.intervalMinutes,
    prompt: fields.prompt,
    command: fields.command ?? "",
    missedPolicy: fields.missedPolicy,
    isEnabled: fields.isEnabled
  };
}

/** Grava o patch por cima da rotina atual. Trocar de executor limpa o que era do anterior. */
function applyPatch(ctx: Ctx, row: RoutineRow, patch: Record<string, unknown>): RoutineView {
  const current = toPayload(row);
  const isNewKind = typeof patch.agentKind === "string" && patch.agentKind !== row.agentKind;
  const base = isNewKind ? { ...current, model: null, effort: "", prompt: "", command: "", isFallbackEnabled: false } : current;
  const prepared = prepareRoutine(requireRoot(ctx), { ...base, ...patch });
  if (!prepared.ok) fail(prepared.problem);
  updateRoutine(ctx.db, row.id, prepared.input, ctx.now);
  const view = findView(ctx, row.id);
  if (!view) fail(`rotina #${row.id} sumiu durante a alteração.`);
  return view;
}

/**
 * Liga e desliga sem passar pelo resto do cadastro, igual ao interruptor do cartao (PATCH /routines/:id/enabled):
 * pausar uma rotina cuja pasta saiu do ar precisa funcionar, e o `applyPatch` exigiria a pasta mae e um diretorio valido.
 */
function setEnabled(ctx: Ctx, row: RoutineRow, isEnabled: boolean): RoutineView {
  setRoutineEnabled(ctx.db, row.id, isEnabled, ctx.now);
  const view = findView(ctx, row.id);
  if (!view) fail(`rotina #${row.id} sumiu durante a alteração.`);
  return view;
}

function findView(ctx: Ctx, id: number): RoutineView | null {
  return listRoutines(ctx.db, ctx.now, readSettings(ctx.db).rootDirectory).find((routine) => routine.id === id) ?? null;
}

function printRoutine(ctx: Ctx, view: RoutineView): void {
  if (ctx.options.json) {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  console.log(`#${view.id} ${view.name} [${view.agentKind}] ${view.isEnabled ? "ativa" : "desativada"}`);
  console.log(`  agenda: ${scheduleText(view)}`);
  console.log(`  próxima: ${view.nextRunAt === null ? "nenhuma" : when(view.nextRunAt)}`);
  console.log(`  diretório: ${view.directory}${view.directoryWarning ? ` (ATENÇÃO: ${view.directoryWarning})` : ""}`);
  console.log(`  timeout: ${view.timeoutMinutes} min | PC desligado: ${view.missedPolicy === "SKIP" ? "pular" : "executar ao ligar"}`);
  if (view.agentKind === "SCRIPT") {
    console.log(`  comando: ${view.command ?? ""}`);
  } else {
    console.log(`  modelo: ${view.model ?? "padrão do CLI"} | effort: ${view.effort || "padrão"} | trocar de agente: ${view.isFallbackEnabled ? "sim" : "não"}`);
    console.log(`  prompt: ${view.prompt}`);
  }
  console.log(`  última: ${runText(view.lastRun)}${view.activeRun ? ` | agora: ${STATUS_TEXT[view.activeRun.status]} (execução #${view.activeRun.id})` : ""}`);
  if (view.lastRun?.error) console.log(`  erro da última: ${view.lastRun.error.split("\n")[0]}`);
}

function warnIfSchedulerStopped(ctx: Ctx): void {
  const stored = getMeta(ctx.db, "last_tick_at");
  const lastTick = stored === null ? null : Number(stored);
  if (lastTick !== null && ctx.now - lastTick <= TICK_STALE_MS) return;
  const since = lastTick === null ? "nunca" : when(lastTick);
  console.log(`atenção: o app não confere a fila desde ${since}. Abra o Syntax Routines para ele despachar.`);
}

// ---------------------------------------------------------------- comandos

interface Command {
  usage: string;
  summary: string;
  run(ctx: Ctx, args: string[]): void;
}

const COMMANDS: Record<string, Command> = {
  list: {
    usage: "list [--json]",
    summary: "rotinas cadastradas, com agenda, próxima execução e como terminou a última",
    run(ctx) {
      const routines = listRoutines(ctx.db, ctx.now, readSettings(ctx.db).rootDirectory);
      if (ctx.options.json) {
        console.log(JSON.stringify({ routines }, null, 2));
        return;
      }
      if (routines.length === 0) {
        console.log("nenhuma rotina cadastrada.");
        return;
      }
      console.log(`${pad("id", 4)}${pad("estado", 11)}${pad("tipo", 8)}${pad("nome", 30)}${pad("agenda", 30)}${pad("próxima", 16)}última`);
      for (const routine of routines) {
        console.log(
          pad(`#${routine.id}`, 4) +
            pad(routine.isEnabled ? "ativa" : "desativada", 11) +
            pad(routine.agentKind, 8) +
            pad(routine.name, 30) +
            pad(scheduleText(routine), 30) +
            pad(routine.nextRunAt === null ? "" : when(routine.nextRunAt), 16) +
            runText(routine.lastRun)
        );
      }
    }
  },

  show: {
    usage: "show <id> [--json]",
    summary: "uma rotina inteira, com o prompt ou o comando completo",
    run(ctx, args) {
      const view = findView(ctx, requireRoutine(ctx, args[0]).id);
      if (view) printRoutine(ctx, view);
    }
  },

  add: {
    usage: "add <rotina.json>",
    summary: "cria uma rotina a partir de um arquivo JSON (confirme com o usuário antes)",
    run(ctx, args) {
      const record = readJsonFile(args[0], "com a rotina");
      const prepared = prepareRoutine(requireRoot(ctx), record);
      if (!prepared.ok) fail(prepared.problem);
      const id = createRoutine(ctx.db, prepared.input, ctx.now);
      const view = findView(ctx, id);
      if (view && ctx.options.json) {
        printRoutine(ctx, view);
        return;
      }
      console.log(`criada #${id}: ${prepared.input.name} [${prepared.input.agentKind}]`);
      if (view) console.log(`  próxima: ${view.nextRunAt === null ? "nenhuma" : when(view.nextRunAt)}`);
    }
  },

  edit: {
    usage: "edit <id> <patch.json>",
    summary: "altera só os campos presentes no arquivo; o resto da rotina fica como está",
    run(ctx, args) {
      const row = requireRoutine(ctx, args[0]);
      const patch = readJsonFile(args[1], "com os campos a alterar");
      if (Object.keys(patch).length === 0) fail("o arquivo não tem nenhum campo para alterar.");
      const view = applyPatch(ctx, row, patch);
      if (!ctx.options.json) console.log(`alterada #${view.id}: ${Object.keys(patch).join(", ")}`);
      printRoutine(ctx, view);
    }
  },

  enable: {
    usage: "enable <id>",
    summary: "liga a rotina (volta a rodar no horário)",
    run(ctx, args) {
      const view = setEnabled(ctx, requireRoutine(ctx, args[0]), true);
      console.log(`#${view.id} ${view.name}: ativa. Próxima: ${view.nextRunAt === null ? "nenhuma" : when(view.nextRunAt)}`);
    }
  },

  disable: {
    usage: "disable <id>",
    summary: "desliga a rotina (a fila dela é cancelada no próximo tick)",
    run(ctx, args) {
      const view = setEnabled(ctx, requireRoutine(ctx, args[0]), false);
      console.log(`#${view.id} ${view.name}: desativada.`);
    }
  },

  "run-now": {
    usage: "run-now <id>",
    summary: "põe uma execução manual na fila; quem executa é o app",
    run(ctx, args) {
      const routine = requireRoutine(ctx, args[0]);
      const runId = enqueueManualRun(ctx.db, routine.id, ctx.now, readSettings(ctx.db).language);
      console.log(`execução #${runId} na fila para "${routine.name}". O app despacha em até 30 s.`);
      console.log(`acompanhe com: runs ${routine.id}   |   saída: log ${runId}`);
      warnIfSchedulerStopped(ctx);
    }
  },

  runs: {
    usage: "runs <id> [--limit N] [--json]",
    summary: "histórico de execuções da rotina, da mais recente para a mais antiga",
    run(ctx, args) {
      const routine = requireRoutine(ctx, args[0]);
      const runs = listRuns(ctx.db, routine.id, null, ctx.options.limit ?? DEFAULT_RUNS_LIMIT);
      if (ctx.options.json) {
        console.log(JSON.stringify({ runs }, null, 2));
        return;
      }
      if (runs.length === 0) {
        console.log(`"${routine.name}" ainda não rodou.`);
        return;
      }
      console.log(`"${routine.name}", ${runs.length} execução(ões):`);
      for (const run of runs) {
        const parts = [
          pad(`#${run.id}`, 6),
          pad(STATUS_TEXT[run.status], 11),
          pad(when(run.finishedAt ?? run.startedAt ?? run.runAt ?? run.scheduledFor), 14),
          pad(durationText(run), 10),
          run.triggerType === "MANUAL" ? "manual" : "agendada"
        ];
        console.log(parts.join(""));
        const detail = run.error?.split("\n")[0] ?? run.note;
        if (detail) console.log(`        ${detail}`);
      }
    }
  },

  log: {
    usage: "log <execução> [--tail N]",
    summary: "saída de uma execução (o mesmo log que o painel mostra)",
    run(ctx, args) {
      const runId = parseNumber("id da execução", args[0]);
      const run = getRun(ctx.db, runId);
      if (!run) fail(`execução #${runId} não existe.`);
      const routine = getRoutine(ctx.db, run.routineId);
      const file = path.join(path.dirname(ctx.dbFile), "logs", `${run.id}.log`);
      const { log, logSize, isLogTruncated } = readLogTail(file);
      const lines = log.split("\n");
      const tail = ctx.options.tail ?? DEFAULT_LOG_LINES;
      console.log(
        `execução #${run.id} de "${routine?.name ?? "rotina apagada"}": ${STATUS_TEXT[run.status]}` +
          `${run.exitCode === null ? "" : `, código ${run.exitCode}`}${durationText(run) ? `, ${durationText(run)}` : ""}`
      );
      if (run.note) console.log(`nota: ${run.note}`);
      if (run.error) console.log(`erro: ${run.error}`);
      if (logSize === 0) {
        console.log(`sem log em ${file}`);
        return;
      }
      console.log(`${file} (${Math.round(logSize / 1024)} KB${isLogTruncated ? ", cortado no início" : ""}), últimas ${Math.min(tail, lines.length)} linha(s):`);
      console.log(lines.slice(-tail).join("\n"));
    }
  },

  rm: {
    usage: "rm <id> --forca",
    summary: "apaga a rotina e o histórico dela (peça confirmação ao usuário)",
    run(ctx, args) {
      const routine = requireRoutine(ctx, args[0]);
      if (!ctx.options.force) fail(`isto apaga "${routine.name}" e todo o histórico. Repita com --forca se o usuário confirmou.`);
      deleteRoutine(ctx.db, routine.id);
      console.log(`apagada #${routine.id}: ${routine.name}`);
    }
  },

  settings: {
    usage: "settings [--json]",
    summary: "pasta mãe, e-mail de aviso, estado do envio e os valores que uma rotina aceita",
    run(ctx) {
      const settings = readSettings(ctx.db);
      const mail = describeMail(ctx.db, loadMailEnv());
      const stored = getMeta(ctx.db, "last_tick_at");
      const lastTickAt = stored === null ? null : Number(stored);
      if (ctx.options.json) {
        console.log(
          JSON.stringify(
            {
              settings,
              mail,
              lastTickAt,
              accepted: {
                agentKind: EXECUTOR_KINDS,
                models: MODELS_BY_KIND,
                efforts: EFFORTS_BY_KIND,
                intervalMinutes: INTERVAL_OPTIONS_MINUTES,
                timeoutMinutes: TIMEOUT_OPTIONS_MINUTES,
                missedPolicy: ["SKIP", "RUN_ON_BOOT"],
                commandMaxChars: COMMAND_MAX_CHARS
              }
            },
            null,
            2
          )
        );
        return;
      }
      console.log(`pasta mãe: ${settings.rootDirectory || "não configurada (configure em Ajustes)"}`);
      console.log(`e-mail de aviso: ${settings.notifyEmail || "nenhum (falha não avisa ninguém)"}`);
      console.log(`envio do aviso: ${mailLine(mail)}`);
      console.log(`idioma do painel, das notas e do e-mail: ${settings.language}`);
      console.log(`em paralelo: ${settings.maxParallel} | atraso ao ligar: ${settings.bootDelayMinutes} min`);
      console.log(`agendador: ${lastTickAt === null ? "ainda não rodou" : `último tick ${when(lastTickAt)}`}`);
      console.log("");
      console.log(`agentKind: ${EXECUTOR_KINDS.join(", ")}`);
      console.log(`modelos CLAUDE: ${MODELS_BY_KIND.CLAUDE.map((model) => model.value).join(", ")}`);
      console.log(`modelos CODEX: ${MODELS_BY_KIND.CODEX.map((model) => model.value).join(", ")}`);
      console.log(`effort CLAUDE: ${EFFORTS_BY_KIND.CLAUDE.join(", ")} | effort CODEX: ${EFFORTS_BY_KIND.CODEX.join(", ")}`);
      console.log(`intervalMinutes: ${INTERVAL_OPTIONS_MINUTES.join(", ")} (ou null para hora fixa)`);
      console.log(`timeoutMinutes: ${TIMEOUT_OPTIONS_MINUTES.join(", ")} | comando até ${COMMAND_MAX_CHARS} caracteres`);
    }
  }
};

/**
 * Ambiente com o .env do app, so para DESCREVER a conta que envia (fonte, servidor, remetente): o CLI nunca envia e
 * nunca imprime senha. Mesma precedencia do servidor: ENV_FILE, senao o .env da raiz do projeto.
 */
function loadMailEnv(): NodeJS.ProcessEnv {
  const file = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.join(projectDir, ".env");
  try {
    process.loadEnvFile(file);
  } catch {
    // sem .env: a conta, se existir, e a salva pelo painel
  }
  return process.env;
}

function mailLine(mail: MailView): string {
  if (!mail.isConfigured) return "não configurado (o usuário configura em Ajustes > Configurar e-mail)";
  const account = `${mail.source === "panel" ? "painel" : ".env"}: ${mail.fromEmail} via ${mail.host}:${mail.port}`;
  if (mail.status.state === "ok") return `conectado (${account}; último envio ou teste ${when(mail.status.at)})`;
  if (mail.status.state === "failed") {
    const detail = mail.status.detail ? ` Detalhe: ${mail.status.detail}` : "";
    return `falhou (${account}; ${when(mail.status.at)}) ${mail.status.message ?? ""}${detail}`.trimEnd();
  }
  return `não testado (${account})`;
}

// ---------------------------------------------------------------- entrada

function helpText(): string {
  const lines = Object.values(COMMANDS).map((command) => `  ${command.usage.padEnd(31)} ${command.summary}`);
  return [
    "Syntax Routines: rotinas agendadas de Claude Code, Codex e scripts neste PC.",
    "",
    "uso: routines <comando> [opções]",
    "",
    "comandos:",
    ...lines,
    "",
    "opções gerais:",
    "  --data <pasta>               outra pasta de dados (padrão: <projeto>\\data)",
    "  --json                       saída em JSON nas leituras",
    "",
    "Criar, alterar e apagar rotina do usuário exige a confirmação dele antes.",
    "Cancelar uma execução que já começou é no painel: só o app tem o processo."
  ].join("\n");
}

function parseArgv(argv: string[]): { command: string; args: string[]; dataDir: string; options: Options } {
  const args: string[] = [];
  const options: Options = { json: false, limit: null, tail: null, force: false };
  // Mesma precedencia do servidor (server/src/index.ts): DATA_DIR do ambiente, senao <projeto>\data.
  let dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(projectDir, "data");
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--data") dataDir = path.resolve(argv[++index] ?? "");
    else if (arg === "--json") options.json = true;
    else if (arg === "--forca" || arg === "--force") options.force = true;
    else if (arg === "--limit") options.limit = parseNumber("--limit", argv[++index]);
    else if (arg === "--tail") options.tail = parseNumber("--tail", argv[++index]);
    else if (arg.startsWith("--")) fail(`opção desconhecida: ${arg}`);
    else args.push(arg);
  }
  return { command: args.shift() ?? "", args, dataDir, options };
}

function main(argv: string[]): number {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    console.log(helpText());
    return 0;
  }
  const { command, args, dataDir, options } = parseArgv(argv);
  const entry = COMMANDS[command];
  if (!entry) {
    console.error(`comando desconhecido: ${command}\n`);
    console.error(helpText());
    return 2;
  }

  const dbFile = path.join(dataDir, "app.db");
  if (!existsSync(dbFile)) {
    console.error(`banco não encontrado em ${dbFile}. Instale o app (service\\install.ps1) ou passe --data <pasta>.`);
    return 1;
  }
  const db = openDb(dbFile);
  try {
    entry.run({ db, now: Date.now(), options, dbFile }, args);
    return 0;
  } finally {
    db.close();
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CliError || error instanceof NotFoundError || error instanceof ConflictError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
