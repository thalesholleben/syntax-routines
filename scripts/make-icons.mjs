// Gera os icones do app a partir do X da marca (public/brand/syntax-x.svg): PNG 192 e 512 para o manifesto e
// syntax-x.ico para o atalho da area de trabalho. Usa o Chrome instalado via playwright-core.
//   node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = path.join(projectDir, "public", "brand");
const svg = readFileSync(path.join(brandDir, "syntax-x.svg"), "utf8");

/** ICO com uma entrada PNG (formato aceito pelo Windows desde o Vista). 256x256 vira 0 no cabecalho. */
function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, png]);
}

async function renderTile(page, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${size}px;height:${size}px;border-radius:${Math.round(size * 0.19)}px;background:#0a0a0a;
      display:flex;align-items:center;justify-content:center;box-sizing:border-box;border:${Math.max(2, Math.round(size / 128))}px solid #292929">
      <div style="width:${Math.round(size * 0.62)}px">${svg}</div>
    </div></body></html>`);
  return page.screenshot({ omitBackground: true, type: "png" });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  for (const size of [192, 512]) {
    writeFileSync(path.join(brandDir, `icon-${size}.png`), await renderTile(page, size));
    console.log(`icon-${size}.png`);
  }
  writeFileSync(path.join(brandDir, "syntax-x.ico"), pngToIco(await renderTile(page, 256)));
  console.log("syntax-x.ico");
} finally {
  await browser.close();
}
