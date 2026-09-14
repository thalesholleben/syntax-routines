// Copia o pacote da skill para a pasta que o cliente le. Sem dependencia, sem build: e um copiar recursivo
// com uma trava contra sobrescrever em silencio uma copia editada a mao.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Cada cliente le as skills da sua propria pasta, e a variante do Claude Code fica um nivel mais fundo
// porque ela tambem e publicavel como plugin.
const clients = {
  "claude-code": {
    source: join(repository, "skills", "claude-code", "skills", "syntax-routines"),
    user: join(homedir(), ".claude", "skills", "syntax-routines"),
    project: join(process.cwd(), ".claude", "skills", "syntax-routines"),
    invocation: "/syntax-routines"
  },
  codex: {
    source: join(repository, "skills", "codex", "syntax-routines"),
    user: join(homedir(), ".agents", "skills", "syntax-routines"),
    project: join(process.cwd(), ".agents", "skills", "syntax-routines"),
    invocation: "$syntax-routines"
  }
};

const args = process.argv.slice(2);
const name = args.find((argument) => !argument.startsWith("--"));
const scope = args.includes("--project") ? "project" : "user";
const force = args.includes("--force");
const client = clients[name];

if (!client) {
  process.stderr.write(
    [
      "uso: node scripts/install-skill.mjs <claude-code|codex> [--project] [--force]",
      "",
      "  --project  instala na pasta atual, em vez da sua pasta de usuario",
      "  --force    substitui uma instalacao que ja existe",
      "",
      "Instalar a skill nao instala o Syntax Routines. Se o app ainda nao existe neste PC,",
      "veja o README.md da raiz (service\\install.ps1 -Build).",
      ""
    ].join("\n")
  );
  process.exit(1);
}

if (!existsSync(client.source)) {
  process.stderr.write(`pacote nao encontrado: ${client.source}\n`);
  process.exit(1);
}

const target = client[scope];
if (existsSync(target) && !force) {
  process.stderr.write(`${target} ja existe. Confira as diferencas e rode de novo com --force para substituir.\n`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
cpSync(client.source, target, { recursive: true, force: true });

const installed = readdirSync(target, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length;
process.stdout.write(
  [
    `${installed} arquivo(s) instalado(s) em ${target}`,
    `Reinicie o ${name} e chame com ${client.invocation}.`,
    "A skill so ensina a usar o app; ela descobre a instalacao pela tarefa agendada SyntaxRoutines.",
    `Detalhes: ${join(target, "references", "setup.md")}`,
    ""
  ].join("\n")
);
