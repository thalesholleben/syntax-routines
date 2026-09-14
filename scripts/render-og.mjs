// Renderiza as imagens Open Graph da landing page (1280x640) a partir de docs/assets/og/*.html.
//   node scripts/render-og.mjs        # pt-BR: docs/assets/og/syntax-routines-og.png
//   node scripts/render-og.mjs --en   # en:    docs/assets/og/syntax-routines-og-en.png
// Cada PNG e copiado para site/, de onde as paginas o referenciam. Usa o Chrome instalado
// (channel "chrome"), como scripts/screenshots.mjs.
import { copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const english = process.argv.includes("--en");
const name = `syntax-routines-og${english ? "-en" : ""}`;
const sourcePath = path.join(projectDir, "docs", "assets", "og", `${name}.html`);
const outputPath = path.join(projectDir, "docs", "assets", "og", `${name}.png`);
const sitePath = path.join(projectDir, "site", `${name}.png`);

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(sourcePath).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.locator("#routines-og").screenshot({ path: outputPath, animations: "disabled" });
  copyFileSync(outputPath, sitePath);
  console.log(`Open Graph rendered at ${path.relative(projectDir, outputPath)} and copied to ${path.relative(projectDir, sitePath)}`);
} finally {
  await browser.close();
}
