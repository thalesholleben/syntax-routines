// Visual smoke for the static sales page. Optional URL supports post-deploy verification.
// Local server: python -m http.server 8769 --bind 127.0.0.1 --directory site
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://127.0.0.1:8769/";
const output = "e2e/.output/site";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  for (const lang of ["pt", "en"]) {
    for (const width of [1280, 768, 360]) {
      await page.setViewportSize({ width, height: 960 });
      await page.goto(new URL(lang === "en" ? "en/" : "./", base).href, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      const hero = page.locator(".lp-hero img[fetchpriority=high]");
      if (!(await hero.getAttribute("src")).includes("dashboard")) throw new Error("Old hero image");
      await page.screenshot({ path: `${output}/${lang}-hero-${width}.png` });
      await page.locator("#shots-title").scrollIntoViewIfNeeded();
      await page.waitForTimeout(1200);
      for (const figure of await page.locator(".lp-shots figure").all()) {
        await figure.scrollIntoViewIfNeeded();
        await page.waitForTimeout(1200);
        if (Number(await figure.evaluate(el => getComputedStyle(el).opacity)) < 0.99) throw new Error("Transparent figure");
        const img = figure.locator("img");
        if (!(await img.evaluate(el => el.complete && el.naturalWidth > 0))) throw new Error(`Broken image ${await img.getAttribute("src")}`);
      }
      await page.locator(".lp-shots").screenshot({ path: `${output}/${lang}-inside-${width}.png` });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Overflow ${lang} ${width}`);
      console.log(`ok ${lang} ${width}: dashboard hero, 5 loaded captures, opaque transitions, no overflow`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Site console clean");
} finally { await browser.close(); }
