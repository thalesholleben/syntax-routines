// Smoke e2e: app buildado + Chrome real (playwright-core, channel "chrome") + agente falso.
// Pre-requisito: npm run build. Screenshots em e2e/.output.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

import { startFakeSmtp } from "./fake-smtp.mjs";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectDir, "e2e", ".output");
const fakeClaude = path.join(projectDir, "e2e", "fake-claude.cmd");

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
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`servidor não respondeu em ${url}`);
}

function check(condition, message) {
  if (!condition) throw new Error(`FALHOU: ${message}`);
  console.log(`ok  ${message}`);
}

mkdirSync(outputDir, { recursive: true });
const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-e2e-")));
const root = path.join(tmp, "pasta-mae");
mkdirSync(path.join(root, "projeto-teste"), { recursive: true });
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
// SMTP falso em 127.0.0.1 para o modal de e-mail (passo 5c): nenhuma mensagem sai da maquina.
const SMTP_PASSWORD = "senha-certa-e2e";
const smtp = await startFakeSmtp({ password: SMTP_PASSWORD });

// O servidor de teste nao pode mandar e-mail de verdade: nada de .env do projeto (ENV_FILE vazio) e nada de SMTP_*
// herdado do processo pai (loadEnvFile nao apaga variavel existente). A SMTP_PASS falsa plantada aqui prova a limpeza:
// se vazasse, o botao de teste tentaria enviar em vez de responder "nao configurado".
const MAIL_ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "MAIL_FROM_EMAIL", "MAIL_FROM_NAME"];
process.env.SMTP_PASS = "nao-usar";
const emptyEnvFile = path.join(tmp, "vazio.env");
writeFileSync(emptyEnvFile, "");
const serverEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !MAIL_ENV_KEYS.includes(key)));

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(projectDir, "dist", "server", "index.mjs")], {
  cwd: projectDir,
  env: { ...serverEnv, PORT: String(port), DATA_DIR: path.join(tmp, "data"), ENV_FILE: emptyEnvFile },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverOutput = "";
server.stdout.on("data", (chunk) => (serverOutput += chunk));
server.stderr.on("data", (chunk) => (serverOutput += chunk));

let browser;
try {
  await waitForServer(`${baseUrl}/api/auth/state`);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  // O Chrome headless fala en-US; sem locale o painel abriria em ingles e os seletores abaixo nao casariam.
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "pt-BR" });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // O 400 do e-mail de teste sem SMTP e esperado (passo 5c); o Chrome registra toda resposta 4xx como erro de console.
    if ((message.location()?.url ?? "").endsWith("/api/settings/notify-test")) return;
    // A senha errada no modal de e-mail responde 502 de proposito (passo 5c).
    if ((message.location()?.url ?? "").endsWith("/api/settings/mail")) return;
    // A sonda de idioma pede um 400 de proposito (passo 2); o Chrome registra todo 4xx como erro de console.
    if ((message.location()?.url ?? "").includes("probe=language")) return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  // 1. primeiro acesso cria a senha; antes, o seletor de idioma troca a tela inteira e volta
  await page.goto(baseUrl);
  await page.getByLabel("Senha", { exact: true }).waitFor();
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("heading", { name: "Create password" }).waitFor();
  check((await page.evaluate(() => document.documentElement.lang)) === "en-US", "seletor EN troca o painel e o lang do documento");
  await page.getByRole("button", { name: "Português" }).click();
  await page.getByRole("heading", { name: "Criar senha" }).waitFor();
  check(true, "seletor PT volta ao português");
  await page.screenshot({ path: path.join(outputDir, "login-1280.png") });
  await page.getByLabel("Senha", { exact: true }).fill("senha-e2e-123");
  await page.getByLabel("Confirmar senha").fill("senha-e2e-123");
  await page.getByRole("button", { name: "Criar senha e entrar" }).click();
  await page.getByRole("heading", { name: "Rotinas", exact: true }).waitFor();
  check(true, "senha criada e painel aberto");

  // 2. ajustes: pasta mae temporaria e agente falso
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByLabel("Pasta mãe").fill(root);
  await page.getByLabel("Binário do Claude Code").fill(fakeClaude);
  await page.getByRole("button", { name: "Salvar ajustes" }).click();
  await page.getByText("Ajustes salvos.").waitFor();
  check(true, "pasta mãe e binário salvos em Ajustes");
  const languageInSettings = await page.evaluate(() => fetch("/api/settings").then((response) => response.json()).then((data) => data.settings.language));
  check(languageInSettings === "pt", "idioma do painel foi gravado em Ajustes ao entrar");
  const englishError = await page.evaluate(() =>
    fetch("/api/routines?probe=language", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "en" },
      body: JSON.stringify({})
    }).then((response) => response.json())
  );
  check(englishError.message === "Invalid data.", "API responde em inglês quando o painel pede em inglês");

  // 3. modal por teclado
  await page.getByRole("button", { name: "Rotinas", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Nova rotina", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Nova rotina", exact: true });
  await dialog.waitFor();
  const isFocusInside = () => page.evaluate(() => Boolean(document.querySelector("dialog[open]")?.contains(document.activeElement)));
  check(await isFocusInside(), "foco dentro do modal ao abrir");
  for (let index = 1; index <= 15; index++) {
    await page.keyboard.press("Tab");
    if (!(await isFocusInside())) throw new Error(`FALHOU: o foco saiu do modal no Tab ${index}`);
  }
  for (let index = 1; index <= 15; index++) {
    await page.keyboard.press("Shift+Tab");
    if (!(await isFocusInside())) throw new Error(`FALHOU: o foco saiu do modal no Shift+Tab ${index}`);
  }
  check(true, "15 Tab e 15 Shift+Tab sem sair do modal");
  await page.screenshot({ path: path.join(outputDir, "modal-1280.png") });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  check(
    await page.evaluate(() => document.activeElement?.textContent?.includes("Nova rotina") ?? false),
    "Escape fecha o modal e o foco volta ao botão Nova rotina"
  );

  // 4. cria a rotina pelo modal
  await trigger.click();
  await dialog.waitFor();
  await dialog.getByLabel("Nome").fill("Rotina e2e");
  await dialog.getByLabel("Diretório").selectOption(path.join(root, "projeto-teste"));
  await dialog.getByLabel("Prompt").fill("responda ok");
  await dialog.getByRole("button", { name: "Salvar rotina" }).click();
  await dialog.waitFor({ state: "detached" });
  const card = page.getByRole("article", { name: "Rotina e2e" });
  await card.waitFor();
  check(await card.getByText("Próxima").isVisible(), "cartão da rotina mostra a próxima execução");

  // 5. executar agora com o agente falso
  await card.getByRole("button", { name: "Executar agora" }).click();
  await card.getByText("Concluída").first().waitFor({ timeout: 30_000 });
  check(true, "execução manual concluída com o agente falso");
  await card.getByRole("button", { name: "Histórico" }).click();
  await card.getByRole("button", { name: "Ver saída" }).first().click();
  const output = page.getByRole("dialog", { name: /Execução/ });
  await output.getByText("ok fake").first().waitFor();
  check(true, "saída do agente aparece no modal de execução");
  await page.keyboard.press("Escape");
  await output.waitFor({ state: "detached" });

  // 5b. rotina de script pelo modal: cartao Script, intervalo, comando real pelo cmd
  await trigger.click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Script, comando CLI" }).click();
  await dialog.getByLabel("Nome").fill("Script e2e");
  await dialog.getByRole("button", { name: "A cada intervalo" }).click();
  await dialog.getByLabel("A cada", { exact: true }).selectOption("15");
  await dialog.getByRole("textbox", { name: /Comando/ }).fill("cmd /c echo rotina-script-ok");
  await dialog.getByLabel("Diretório").selectOption(path.join(root, "projeto-teste"));
  await page.screenshot({ path: path.join(outputDir, "modal-script-1280.png") });
  await dialog.getByRole("button", { name: "Salvar rotina" }).click();
  await dialog.waitFor({ state: "detached" });
  const scriptCard = page.getByRole("article", { name: "Script e2e" });
  await scriptCard.waitFor();
  check(await scriptCard.getByText("a cada 15 min").isVisible(), "cartão do script mostra a agenda por intervalo");
  await scriptCard.getByRole("button", { name: "Executar agora" }).click();
  await scriptCard.getByText("Concluída").first().waitFor({ timeout: 30_000 });
  await scriptCard.getByRole("button", { name: "Histórico" }).click();
  await scriptCard.getByRole("button", { name: "Ver saída" }).first().click();
  const scriptOutput = page.getByRole("dialog", { name: /Execução/ });
  await scriptOutput.getByText("rotina-script-ok").first().waitFor();
  check(true, "script rodou pelo cmd e a saída aparece no modal de execução");
  await page.keyboard.press("Escape");
  await scriptOutput.waitFor({ state: "detached" });

  await scriptCard.getByRole("button", { name: "Editar" }).click();
  const editDialog = page.getByRole("dialog", { name: "Editar rotina", exact: true });
  await editDialog.waitFor();
  await editDialog.getByRole("textbox", { name: /Comando/ }).fill("cmd /c exit 3");
  await editDialog.getByRole("button", { name: "Salvar rotina" }).click();
  await editDialog.waitFor({ state: "detached" });
  await scriptCard.getByRole("button", { name: "Executar agora" }).click();
  await scriptCard.getByText("Falhou").first().waitFor({ timeout: 30_000 });
  check(true, "comando com código de saída 3 vira Falhou");
  await page.screenshot({ path: path.join(outputDir, "rotinas-1280.png") });

  // 5c. e-mail pelo modal: sem conta nenhuma no comeco (a SMTP_PASS do processo pai nao vazou); senha errada mostra o
  // motivo e deixa o modal aberto; senha certa conecta; o teste chega ao SMTP falso; a senha nao aparece na API, no
  // banco nem no log.
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByText("Não configurado", { exact: true }).waitFor();
  const mailBefore = await page.evaluate(() => fetch("/api/settings").then((response) => response.json()).then((data) => data.mail));
  const notifyStatus = await page.evaluate(() => fetch("/api/settings/notify-test", { method: "POST" }).then((response) => response.status));
  check(mailBefore.isConfigured === false && mailBefore.source === null && notifyStatus === 400, "sem conta de e-mail no servidor de teste (a SMTP_PASS do processo pai não vazou)");
  await page.getByRole("button", { name: "Configurar e-mail" }).click();
  const mailDialog = page.getByRole("dialog", { name: "Configurar e-mail" });
  await mailDialog.waitFor();
  await mailDialog.getByLabel("Provedor").selectOption("other");
  await mailDialog.getByLabel("Servidor SMTP").fill("127.0.0.1");
  await mailDialog.getByLabel("Porta").fill(String(smtp.port));
  await mailDialog.getByLabel("E-mail que envia").fill("avisos@example.com");
  check((await mailDialog.getByLabel("E-mail que recebe os avisos").inputValue()) === "avisos@example.com", "o destinatário acompanha o e-mail que envia");
  await mailDialog.getByLabel("E-mail que recebe os avisos").fill("dono@example.com");
  await mailDialog.getByLabel("Senha", { exact: true }).fill("senha-errada");
  await mailDialog.getByRole("button", { name: "Salvar e testar" }).click();
  await mailDialog.getByRole("alert").filter({ hasText: "recusou o e-mail ou a senha" }).waitFor({ timeout: 30_000 });
  check(await mailDialog.isVisible(), "senha errada mostra o motivo e o modal continua aberto");
  await mailDialog.getByLabel("Senha", { exact: true }).fill(SMTP_PASSWORD);
  await mailDialog.getByRole("button", { name: "Salvar e testar" }).click();
  await mailDialog.waitFor({ state: "detached", timeout: 30_000 });
  await page.getByText("Conectado", { exact: true }).waitFor();
  check(true, "senha certa conecta, fecha o modal e o selo mostra Conectado");
  await page.getByRole("button", { name: "Enviar e-mail de teste" }).click();
  await page.getByText("E-mail de teste enviado para dono@example.com.").waitFor({ timeout: 30_000 });
  const delivered = smtp.messages.at(-1);
  check(
    Boolean(delivered?.to.includes("<dono@example.com>") && delivered.data.includes("[Syntax Routines] E-mail de teste")),
    "o e-mail de teste chegou ao SMTP falso"
  );
  const settingsJson = await page.evaluate(() => fetch("/api/settings").then((response) => response.text()));
  const dataFiles = ["app.db", "app.db-wal", "app.log"].map((name) => path.join(tmp, "data", name)).filter((file) => existsSync(file));
  const leaked = dataFiles.filter((file) => {
    const bytes = readFileSync(file);
    return bytes.includes(Buffer.from(SMTP_PASSWORD, "utf8")) || bytes.includes(Buffer.from(SMTP_PASSWORD, "utf16le"));
  });
  check(!settingsJson.includes(SMTP_PASSWORD) && leaked.length === 0, `senha do e-mail fora da API, do banco e do log${leaked.length ? `: achada em ${leaked.join(", ")}` : ""}`);
  await page.reload();
  await page.getByRole("button", { name: "Ajustes", exact: true }).click();
  await page.getByText("Conectado", { exact: true }).waitFor();
  check(true, "o selo Conectado continua depois de recarregar a página");
  await page.screenshot({ path: path.join(outputDir, "ajustes-1280.png") });
  await page.getByRole("button", { name: "Rotinas", exact: true }).click();
  await scriptCard.waitFor();

  // 5d. filtro do cabecalho: busca sem acento nem caixa, filtro por tipo e "Limpar filtro"
  const search = page.getByRole("searchbox", { name: "Buscar pelo nome" });
  await search.fill("SCRÍPT");
  await card.waitFor({ state: "hidden" });
  check((await page.getByRole("article").count()) === 1 && (await scriptCard.isVisible()), "busca pelo nome ignora acento e caixa");
  await search.fill("");
  await page.getByRole("combobox", { name: "Filtrar por tipo" }).selectOption("SCRIPT");
  await card.waitFor({ state: "hidden" });
  await page.getByText("1 de 2 rotinas").waitFor();
  check((await page.getByRole("article").count()) === 1 && (await scriptCard.isVisible()), "filtro por tipo deixa só o script e mostra 1 de 2");
  await page.getByRole("button", { name: "Limpar filtro" }).click();
  await card.waitFor();
  check((await page.getByRole("article").count()) === 2, "Limpar filtro devolve as duas rotinas");

  // 6. mobile sem rolagem horizontal
  await page.setViewportSize({ width: 360, height: 800 });
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.screenshot({ path: path.join(outputDir, "rotinas-360.png") });
  check(!hasOverflow, "360 px sem rolagem horizontal");

  check(consoleErrors.length === 0, `console sem erros${consoleErrors.length ? `: ${consoleErrors.join(" | ")}` : ""}`);
  console.log("\nsmoke e2e verde");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`\n--- saída do servidor ---\n${serverOutput}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await smtp.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
