// Gera as imagens do README com dados de demonstracao, num app efemero: nada do banco real entra na foto.
// Pre-requisito: npm run build (usa dist/server e dist/routines.mjs). Chrome instalado (channel "chrome").
//   node scripts/screenshots.mjs --root C:\tmp\Projetos     # pasta mae que aparece nas fotos (criada se faltar)
// Saida em docs/assets/screenshots/. As rotinas sao cadastradas pelo proprio CLI do app.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "docs", "assets", "screenshots");
const fakeClaude = path.join(projectDir, "e2e", "fake-claude.cmd");
const cli = path.join(projectDir, "dist", "routines.mjs");

const rootArg = process.argv.indexOf("--root");
const root = rootArg === -1 ? path.join(os.tmpdir(), "syntax-routines-demo") : path.resolve(process.argv[rootArg + 1]);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`servidor não respondeu em ${url}`);
}

const demoRoutines = [
  {
    name: "Resumo diário do Google Ads",
    agentKind: "CLAUDE",
    directory: "clientes\\loja-exemplo",
    model: "claude-opus-5",
    effort: "high",
    timeoutMinutes: 60,
    isFallbackEnabled: true,
    days: [1, 2, 3, 4, 5],
    time: "09:00",
    intervalMinutes: null,
    prompt:
      "Leia as campanhas de ontem em dados/ads/ e escreva o resumo do dia em relatorios/AAAA-MM-DD.md: gasto, conversões, custo por conversão e o que mudou em relação à semana. Se o arquivo de hoje já existir, não faça nada.",
    command: "",
    missedPolicy: "RUN_ON_BOOT",
    isEnabled: true
  },
  {
    name: "Revisão semanal do repositório",
    agentKind: "CODEX",
    directory: "clientes\\loja-exemplo",
    model: "gpt-5.6-terra",
    effort: "high",
    timeoutMinutes: 90,
    isFallbackEnabled: false,
    days: [1],
    time: "07:30",
    intervalMinutes: null,
    prompt:
      "Rode a suíte de testes e o lint. Liste dependência com vulnerabilidade conhecida, teste vermelho e TODO com mais de 30 dias em docs/revisao-semanal.md. Não altere código nem faça commit.",
    command: "",
    missedPolicy: "RUN_ON_BOOT",
    isEnabled: true
  },
  {
    name: "Fila de publicação do Instagram",
    agentKind: "SCRIPT",
    directory: "ferramentas\\instagram",
    model: null,
    effort: "",
    timeoutMinutes: 15,
    isFallbackEnabled: false,
    days: [0, 1, 2, 3, 4, 5, 6],
    time: "00:00",
    intervalMinutes: 15,
    prompt: "",
    command: "cmd /c echo fila vazia: nada para publicar agora",
    missedPolicy: "SKIP",
    isEnabled: true
  },
  {
    name: "Conferir o backup da noite",
    agentKind: "SCRIPT",
    directory: "ferramentas\\backup",
    model: null,
    effort: "",
    timeoutMinutes: 15,
    isFallbackEnabled: false,
    days: [0, 1, 2, 3, 4, 5, 6],
    time: "08:00",
    intervalMinutes: null,
    prompt: "",
    command: "powershell -NoProfile -ExecutionPolicy Bypass -File check-backup.ps1 -LatestJson D:\\Backups\\logs\\latest.json",
    missedPolicy: "RUN_ON_BOOT",
    isEnabled: true
  }
];

for (const sub of ["clientes\\loja-exemplo", "ferramentas\\instagram", "ferramentas\\backup"]) {
  mkdirSync(path.join(root, sub), { recursive: true });
}
mkdirSync(outputDir, { recursive: true });
const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-shots-")));
const dataDir = path.join(tmp, "data");
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;

// Sem e-mail de verdade: mesmo isolamento do smoke e2e.
const MAIL_ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM_EMAIL", "MAIL_FROM_NAME"];
const emptyEnvFile = path.join(tmp, "vazio.env");
writeFileSync(emptyEnvFile, "");
const serverEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !MAIL_ENV_KEYS.includes(key)));

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(projectDir, "dist", "server", "index.mjs")], {
  cwd: projectDir,
  env: { ...serverEnv, PORT: String(port), DATA_DIR: dataDir, ENV_FILE: emptyEnvFile },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk));
server.stderr.on("data", (chunk) => (serverOutput += chunk));

function addByCli(routine) {
  const file = path.join(tmp, `${routine.name.replace(/[^a-z0-9]+/giu, "-")}.json`);
  writeFileSync(file, JSON.stringify(routine));
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "add", file, "--data", dataDir], {
    cwd: projectDir,
    encoding: "utf8"
  });
  if (result.status !== 0) throw new Error(`CLI add falhou para ${routine.name}: ${result.stderr || result.stdout}`);
  console.log(result.stdout.trim().split("\n")[0]);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
  console.log(`foto  ${name}.png`);
}

let browser;
try {
  await waitForServer(`${baseUrl}/api/auth/state`);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });

  await page.goto(baseUrl);
  await page.getByLabel("Senha", { exact: true }).waitFor();
  await shot(page, "login");
  await page.getByLabel("Senha", { exact: true }).fill("senha-de-demonstracao");
  await page.getByLabel("Confirmar senha").fill("senha-de-demonstracao");
  await page.getByRole("button", { name: "Criar senha e entrar" }).click();
  await page.getByRole("heading", { name: "Rotinas", exact: true }).waitFor();

  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByLabel("Pasta mãe").fill(root);
  await page.getByLabel("Binário do Claude Code").fill(fakeClaude);
  await page.getByLabel("E-mail de aviso").fill("voce@exemplo.com.br");
  await page.getByRole("button", { name: "Salvar ajustes" }).click();
  await page.getByText("Ajustes salvos.").waitFor();
  // O binario falso nao e assunto da foto: volta o campo ao padrao so na tela (sem salvar).
  await page.getByLabel("Binário do Claude Code").fill("claude");
  await page.mouse.move(0, 0);
  await shot(page, "ajustes");

  for (const routine of demoRoutines) addByCli(routine);

  await page.getByRole("button", { name: "Rotinas", exact: true }).click();
  const ads = page.getByRole("article", { name: "Resumo diário do Google Ads" });
  const fila = page.getByRole("article", { name: "Fila de publicação do Instagram" });
  await ads.waitFor();
  await ads.getByRole("button", { name: "Executar agora" }).click();
  await ads.getByText("Concluída").first().waitFor({ timeout: 30_000 });
  await fila.getByRole("button", { name: "Executar agora" }).click();
  await fila.getByText("Concluída").first().waitFor({ timeout: 30_000 });
  await fila.getByRole("button", { name: "Histórico" }).click();
  await page.mouse.move(0, 0);
  await shot(page, "rotinas");

  await ads.getByRole("button", { name: "Editar" }).click();
  const editAgent = page.getByRole("dialog", { name: "Editar rotina", exact: true });
  await editAgent.waitFor();
  await page.mouse.move(0, 0);
  await shot(page, "modal-agente");
  await page.keyboard.press("Escape");
  await editAgent.waitFor({ state: "detached" });

  await fila.getByRole("button", { name: "Editar" }).click();
  const editScript = page.getByRole("dialog", { name: "Editar rotina", exact: true });
  await editScript.waitFor();
  await page.mouse.move(0, 0);
  await shot(page, "modal-script");
  await page.keyboard.press("Escape");
  await editScript.waitFor({ state: "detached" });

  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "rotinas-mobile");
  console.log(`\nimagens em ${outputDir}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`\n--- saída do servidor ---\n${serverOutput}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
