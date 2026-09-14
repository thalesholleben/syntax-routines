# Landing page

Static page for `routines.syntaxlab.com.br`: `index.html` (Brazilian Portuguese), `en/index.html`,
`css/`, `js/`, `img/`, `fonts/` (Montserrat and JetBrains Mono, OFL, self-hosted), `robots.txt`,
`sitemap.xml`, `llms.txt` and the two Open Graph images. No build step and every path is relative,
so the folder serves as-is from the root of a host or from a subfolder. `canonical`, `hreflang`
and `og:url` are absolute: change them in both HTML files, `sitemap.xml` and `robots.txt` if the
domain changes.

- `docs/design-direction.md` and `docs/css-namespaces.md` are the design notes for whoever edits
  the page; they are not meant to be served.
- Images come from `../docs/assets/screenshots/` through `node ../scripts/site-images.py`
  (webp at 640/960/1280); the Open Graph PNGs come from `node ../scripts/render-og.mjs`
  (and `--en`), which also copies them here.
- Validation used before publishing: 0 errors in the frontend gate, no horizontal overflow at
  360/768/1280 and a clean console, both languages.
