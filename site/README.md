# Landing page

Static page published at <https://routines.syntaxlab.com.br> (Brazilian Portuguese) and
<https://routines.syntaxlab.com.br/en/> (English): `index.html`, `en/index.html`,
`css/`, `js/`, `img/`, `fonts/` (Montserrat and JetBrains Mono, OFL, self-hosted), `robots.txt`,
`sitemap.xml`, `llms.txt` and the two Open Graph images. No build step and every path is relative,
so the folder serves as-is from the root of a host or from a subfolder. `canonical`, `hreflang`
and `og:url` are absolute: change them in both HTML files, `sitemap.xml` and `robots.txt` if the
domain changes.

- `docs/design-direction.md` and `docs/css-namespaces.md` are the design notes for whoever edits
  the page; they are not meant to be served.
- Images come from `../docs/assets/screenshots/` through `python ../scripts/site-images.py`
  (webp at 640/960/1280); the Open Graph PNGs come from `node ../scripts/render-og.mjs`
  (and `--en`), which also copies them here.
- Validation used before publishing: 0 errors in the frontend gate, no horizontal overflow at
  360/768/1280 and a clean console, both languages.

## Refresh product captures

After `npm run build`, from the repository root:

```powershell
node scripts/screenshots.mjs
node scripts/screenshots.mjs --lang en
npx tsx e2e/dashboard.ts --site
python scripts/site-images.py
```

Captures wait for fonts and 1200ms before saving, so entrance transitions finish.
The dashboard uses 100 demo routines in a disposable database without starting a scheduler.
The phone frame illustrates responsive layout, not remote access to the Windows app.

## Publish to Hostinger

Follow the workspace integration runbook at `03-ferramentas/mega-brain/hostinger-api/README.md`.
Target: `routines.syntaxlab.com.br`, principal account `u739884598`, own website directory
`/home/u739884598/domains/routines.syntaxlab.com.br/public_html`.

Stage only `index.html`, `en/`, `css/`, `js/`, `img/`, `fonts/`, `favicon.ico`, `robots.txt`,
`sitemap.xml`, `llms.txt` and the two Open Graph PNGs. Keep docs and README out.
Preserve a local archive of the previous committed `site/` for rollback.

Validate with CSS/frontend gates and `node scripts/check-site.mjs` against a local server
(`python -m http.server 8769 --bind 127.0.0.1 --directory site`). Run the Hostinger `deploy`
command with `--dominio routines.syntaxlab.com.br --pasta <staging>` first, check the target,
then repeat with `--confirmo`. Clear the host cache through the documented DELETE endpoint.
Verify both public languages and new assets, then run `node scripts/check-site.mjs https://routines.syntaxlab.com.br/`.
