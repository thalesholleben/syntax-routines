// Visual and read-only dashboard checks with 100 demo routines. No scheduler is started.
// Run after the build: npx tsx e2e/dashboard.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createApp } from "../server/src/app";
import { openDb } from "../server/src/db";
import { readDashboard } from "../server/src/dashboard";
import { createMailer } from "../server/src/mailer";
import { createRoutine } from "../server/src/routines";
import { createScheduler } from "../server/src/scheduler";

const tmp = mkdtempSync(path.join(os.tmpdir(), "sr-dashboard-"));
const output = path.resolve("e2e/.output");
mkdirSync(output, { recursive: true });
const db = openDb(path.join(tmp, "app.db"));
const now = Date.now();
const names = ["Resumo de campanhas", "Revisão de repositórios", "Conferência de backups", "Fila de conteúdo", "Relatório de operação", "Sincronização de projetos", "Verificação de serviços", "Organização de documentos"];
const kinds = ["CLAUDE", "CODEX", "SCRIPT"] as const;
const insertRun = db.prepare(`INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, agent_kind, started_at, finished_at, created_at)
  VALUES (?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?)`);
db.exec("BEGIN");
for (let i = 0; i < 100; i++) {
  const kind = kinds[i % 3];
  const id = createRoutine(db, { name: `${names[i % names.length]} ${String(i + 1).padStart(2, "0")}`, agentKind: kind,
    directory: tmp, model: null, effort: "high", timeoutMinutes: 60, isFallbackEnabled: false,
    days: [0, 1, 2, 3, 4, 5, 6], time: `${String(i % 24).padStart(2, "0")}:30`, intervalMinutes: i % 7 === 0 ? 30 : null,
    prompt: "Demo only", command: null, missedPolicy: "SKIP", isEnabled: i % 11 !== 0 }, now);
  for (let j = 0; j < 30; j++) {
    const at = now - ((i * 37 + j * 97) % 2800) * 60_000;
    const status = (i + j) % 31 === 0 ? "FAILED" : (i + j) % 23 === 0 ? "SKIPPED" : "SUCCEEDED";
    insertRun.run(id, at, at, status, kind, status === "SKIPPED" ? null : at - 60_000 - i * 2000, status === "SKIPPED" ? null : at, at);
  }
  if (i < 5) insertRun.run(id, now - 180_000, i < 2 ? now - 180_000 : now + 120_000, i < 2 ? "RUNNING" : "QUEUED", kind, i < 2 ? now - 180_000 : null, null, now - 180_000);
}
db.prepare("INSERT INTO meta (key, value) VALUES ('last_tick_at', ?)").run(String(now));
db.exec("COMMIT");
const scheduler = createScheduler({ db, logsDir: tmp, now: () => now, runAgent: () => { throw new Error("Preview must not execute"); } });
const app = createApp({ db, scheduler, logsDir: tmp, mailer: createMailer({ db, env: {} }), panelUrl: "http://127.0.0.1", clientDir: path.resolve("dist/client"), now: () => now });
const server = http.createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("No test port");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const start = performance.now();
  readDashboard(db, now, 24);
  console.log(`100 routines / 3005 runs: snapshot in ${(performance.now() - start).toFixed(1)} ms`);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, locale: "pt-BR" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByLabel("Senha", { exact: true }).fill("preview-local-only");
  await page.getByLabel("Confirmar senha").fill("preview-local-only");
  await page.getByRole("button", { name: "Criar senha e entrar" }).click();
  await page.getByRole("button", { name: "Painel", exact: true }).click();
  await page.getByRole("heading", { name: "90 ativas de 100 rotinas" }).waitFor();
  for (const width of [1440, 1280, 768, 360]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.locator(".sr-dashboard__scroll").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: path.join(output, `dashboard-demo-${width}.png`) });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Overflow at ${width}`);
    const overlaps = await page.locator(".sr-dashboard__lane").first().locator("button").evaluateAll(buttons => buttons.some((button, index) => {
      const next = buttons[index + 1];
      return next && button.getBoundingClientRect().right > next.getBoundingClientRect().left;
    }));
    if (overlaps) throw new Error(`Overlapping forecast cells at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".sr-dashboard__scroll").evaluate(element => { element.scrollTop = 650; });
  await page.screenshot({ path: path.join(output, "dashboard-demo-details.png") });
  await page.locator(".sr-dashboard__scroll").evaluate(element => { element.scrollTop = 0; });
  // Save rendered DOM for the CSS/frontend checks; this file is ignored with all e2e output.
  writeFileSync(path.join(output, "dashboard-rendered.html"), await page.content());
  await page.route("**/api/dashboard*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Offline test" }) }));
  await page.getByRole("button", { name: "Atualizar painel" }).click();
  await page.getByRole("alert").filter({ hasText: "Mostrando o último estado" }).waitFor();
  if (!(await page.getByRole("heading", { name: "90 ativas de 100 rotinas" }).isVisible())) throw new Error("Stale data was lost");
  await page.unroute("**/api/dashboard*");
  await page.getByRole("button", { name: "Atualizar painel" }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  db.exec("DELETE FROM runs; DELETE FROM routines;");
  await page.getByRole("button", { name: "Atualizar painel" }).click();
  await page.getByRole("heading", { name: "0 ativas de 0 rotinas" }).waitFor();
  await page.getByRole("heading", { name: "Nenhuma rotina ativa agendada" }).waitFor();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("dashboard demo: 100 routines, active queue, responsive cells, stale/recovery and empty state passed");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  rmSync(tmp, { recursive: true, force: true });
}
