// A skill documenta o CLI deste repositorio, entao ela envelhece no dia em que um comando muda. Estes
// gates existem para essa quebra aparecer no MESMO commit que mudou o comando, que e a razao de o pacote
// morar aqui dentro e nao em um repositorio proprio.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const claudeCode = join(repository, "skills", "claude-code", "skills", "syntax-routines");
const codex = join(repository, "skills", "codex", "syntax-routines");
const failures = [];

function read(path) {
  return readFileSync(path, "utf8").replace(/\r\n/gu, "\n");
}

function digest(path) {
  return createHash("sha256").update(read(path)).digest("hex");
}

for (const path of [
  join(claudeCode, "SKILL.md"),
  join(codex, "SKILL.md"),
  join(codex, "agents", "openai.yaml"),
  join(repository, ".claude-plugin", "marketplace.json"),
  join(repository, "skills", "claude-code", ".claude-plugin", "plugin.json"),
  join(repository, "skills", "README.md")
]) {
  if (!existsSync(path)) failures.push(`falta ${path}`);
}

// setup.md difere de proposito (instalar difere por cliente). As referencias do CLI sao um texto so e
// precisam ser identicas nas duas variantes.
for (const shared of ["references/cli.md", "references/rotinas.md"]) {
  const left = join(claudeCode, shared);
  const right = join(codex, shared);
  if (!existsSync(left) || !existsSync(right)) {
    failures.push(`falta a referencia compartilhada ${shared}`);
    continue;
  }
  if (digest(left) !== digest(right)) failures.push(`${shared} diverge entre o pacote do Claude Code e o do Codex`);
}

// O registro do marketplace precisa apontar para um plugin de verdade, e os dois precisam usar o mesmo nome,
// senao o comando de instalacao do README resolve para nada em silencio.
const marketplacePath = join(repository, ".claude-plugin", "marketplace.json");
if (existsSync(marketplacePath)) {
  const marketplace = JSON.parse(read(marketplacePath));
  for (const plugin of marketplace.plugins ?? []) {
    const manifest = join(repository, plugin.source ?? "", ".claude-plugin", "plugin.json");
    if (!existsSync(manifest)) {
      failures.push(`o plugin ${plugin.name} do marketplace nao tem manifesto em ${manifest}`);
      continue;
    }
    const declared = JSON.parse(read(manifest)).name;
    if (declared !== plugin.name) failures.push(`o marketplace chama o plugin de ${plugin.name}, mas o manifesto diz ${declared}`);
  }
}

/** Comandos que o CLI de verdade oferece, lidos do proprio `--help`. */
function commandsFromCli() {
  const bundle = join(repository, "dist", "routines.mjs");
  const tsx = join(repository, "node_modules", "tsx", "dist", "cli.mjs");
  const args = existsSync(bundle)
    ? ["--disable-warning=ExperimentalWarning", bundle, "--help"]
    : ["--disable-warning=ExperimentalWarning", tsx, join(repository, "scripts", "routines-cli.ts"), "--help"];
  if (!existsSync(bundle) && !existsSync(tsx)) {
    failures.push("sem dist/routines.mjs e sem tsx: rode npm ci ou npm run build antes do gate");
    return null;
  }
  const result = spawnSync(process.execPath, args, { cwd: repository, encoding: "utf8", timeout: 60_000 });
  if (result.status !== 0) {
    failures.push(`o --help do CLI falhou: ${(result.stderr || result.stdout || "").trim().split("\n")[0]}`);
    return null;
  }
  const lines = result.stdout.replace(/\r\n/gu, "\n").split("\n");
  const start = lines.indexOf("comandos:");
  if (start === -1) {
    failures.push("o --help do CLI nao tem a seção `comandos:`");
    return null;
  }
  const commands = new Set();
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break;
    const name = line.trim().split(/\s+/u)[0];
    if (name) commands.add(name);
  }
  return commands;
}

/** Comandos que a referencia ensina: primeira celula de cada linha da tabela de "## Comandos". */
function commandsFromReference() {
  const path = join(claudeCode, "references", "cli.md");
  if (!existsSync(path)) return null;
  const lines = read(path).split("\n");
  const start = lines.indexOf("## Comandos");
  if (start === -1) {
    failures.push("references/cli.md nao tem a seção `## Comandos`");
    return null;
  }
  const commands = new Set();
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("| `")) continue;
    const cell = line.slice(1).split("|")[0];
    for (const [, quoted] of cell.matchAll(/`([^`]+)`/gu)) {
      const name = quoted.trim().split(/\s+/u)[0];
      if (name && !name.startsWith("-")) commands.add(name);
    }
  }
  return commands;
}

const cliCommands = commandsFromCli();
const referenceCommands = commandsFromReference();
if (cliCommands && referenceCommands) {
  if (cliCommands.size === 0) failures.push("nenhum comando encontrado no --help do CLI");
  if (referenceCommands.size === 0) failures.push("nenhum comando encontrado na tabela de references/cli.md");
  for (const command of [...referenceCommands].sort()) {
    if (!cliCommands.has(command)) failures.push(`cli.md ensina \`${command}\`, que nao existe no CLI`);
  }
  for (const command of [...cliCommands].sort()) {
    if (!referenceCommands.has(command)) failures.push(`o CLI tem \`${command}\`, que cli.md nao documenta`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`Pacotes de skill reprovados:\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Pacotes de skill aprovados.\n");
