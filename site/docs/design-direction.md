# Direção visual · landing page do Syntax Routines

Página estática em `site/` (HTML, CSS e JS puro, sem build). Domínio `routines.syntaxlab.com.br`.
Quem for mexer na página lê este arquivo antes, e o registro de classes em `css-namespaces.md`.

## Direção

**01 Cinematográfica azul** (skill `frontend-expert`, `references/direcoes.md`), adaptada aos
tokens do próprio produto: a LP tem de parecer a mesma família do painel do Routines, do
syntaxlab.com.br e do Backlog Syntax, com o azul do Routines como único acento. Sem Bebas Neue:
a marca é Montserrat, e o contraste tipográfico vem dos pesos extremos (800 no display, 400 no
corpo) mais uma mono para o que é "máquina" (kicker, terminal, grade de dias, números).

## Tokens (`site/css/site.css`, `:root`)

```css
--bg: #0a0a0a; --surface: #171717; --surface-2: #212121; --surface-3: #292929;
--ink: #f3f3f0; --muted: #a0a29a; --faint: #7a7c75;
--line: #292929; --line-strong: #3c3c3c;
--accent: #1e9dc8; --accent-hover: #2bb0dc; --accent-ink: #05151b; --accent-soft: rgba(30,157,200,.14);
--ok: #5ddcaf; --warn: #f0b44e; --bad: #ff6b5e;
--font-display: 'Montserrat'; --font-body: 'Montserrat'; --font-mono: 'JetBrains Mono';
--r-control: 8px; --r-card: 12px;
```

Os hex são os de `client/src/index.css` do app (fundo, superfícies, texto, apagado, acento,
estados). `--faint` é o único valor novo, para legenda de imagem sobre fundo escuro.

## Tipografia

| Papel | Fonte | Peso | Tamanho |
| --- | --- | --- | --- |
| Título do hero | Montserrat | 800 | `clamp(2.4rem, 6.2vw, 4.6rem)`, `line-height .98`, `letter-spacing -.04em` |
| Título de seção | Montserrat | 800 | `clamp(1.75rem, 3.6vw, 2.75rem)` |
| Corpo | Montserrat | 400/500 | 16px (15px no mobile), `line-height 1.6` |
| Kicker, terminal, grade de dias, números | JetBrains Mono | 500/600 | 12 a 14px, `letter-spacing .16em` no kicker |

Arquivos em `site/fonts/`: Montserrat latin 400/500/600/700/800 (`@fontsource/montserrat`) e
JetBrains Mono latin variável 100 a 800 (kit da skill). Licenças OFL ao lado. `@font-face` com
`font-display: swap`; preload só do 800 e do 400 da Montserrat. Nunca `fonts.googleapis.com`.

## Dispositivo assinatura

A **grade de dias** do banner do README (SEG a DOM, três linhas: cheia, meia, vazia), em CSS.
Aparece no hero (atrás da captura, apagada) e na faixa de princípio (em primeiro plano, com
uma célula de cada vez acendendo em `@keyframes`, desligado em `prefers-reduced-motion`).

## Profundidade (2 camadas de atmosfera + 1 assinatura)

1. Véu: gradiente duplo sobre o cartão de login no fecho (`fx-veil.is-left`).
2. Glow radial do acento atrás do hero e do fecho (`fx-glow`).
3. Assinatura: a grade de dias.

Sem ruído, sem marca d'água, sem vidro. Sombra difusa só na captura do hero e no terminal.

## Movimento (médio, decidido em 15/09/2026)

Era leve; o dono pediu mais presença ao anunciar o macOS. O teto continua sendo o mesmo:
nada de biblioteca de animação, nada que mexa em layout e tudo desligado em
`prefers-reduced-motion`.

- Reveal por scroll (`fx-reveal`, IntersectionObserver em `js/site.js`), com stagger de 90 ms
  nos grupos. Sem JS a página nasce inteira visível (`html[data-js]` guarda o estado inicial) e
  o `<noscript>` reforça.
- Grade de dias com pulso de 6 s.
- Transições de 160 a 250 ms em botão e card.
- Brilho varrendo os CTAs a cada 7 s (`fx-btn-shine`), com o botão do Mac defasado em 3,5 s
  para os dois não piscarem juntos.
- Pontos de luz subindo atrás da captura do hero (`fx-particles`, criados no `js/site.js`).
- Grade vertical nos painéis de instalação (`fx-grid-lines`) e flutuação lenta no celular da
  galeria (`fx-float`), um por tela.
- Sublinhado direcional nos links do menu (`fx-underline`) e dica de rolagem no hero.
- Tudo desligado em `prefers-reduced-motion: reduce`. Nada de GSAP, Lenis ou WebGL.

## Densidade: padrão

Seções com `padding-block: clamp(4rem, 9vw, 7.5rem)`, container de 1120px, gutter de 20px no
mobile e 32px acima de 768px.

## Plano de imagens

| Onde | Imagem | Origem | Tratamento |
| --- | --- | --- | --- |
| Hero | `dashboard` (1280x900), versão EN própria | `docs/assets/screenshots/dashboard.png` | webp 640/960/1280 + png 960, moldura, leve inclinação no desktop, `fetchpriority="high"` |
| Tipos de rotina | `anthropic.svg`, `openai.svg`, terminal inline | `public/brand/` | pintados no `--ink` via `mask` |
| Capturas | `dashboard`, `dashboard-mobile`, `modal-agente`, `modal-script`, `ajustes`, PT e EN | `docs/assets/screenshots/` | molduras CSS de notebook/celular, webp + png, `loading="lazy"`, dimensões reservadas |
| Fecho | `login-card` (recorte x 600..1280 de `login.png`) | `docs/assets/screenshots/login.png` | ancorado à direita, atrás do véu, opacidade .5 |
| OG | `login-bg-desktop.webp` | `public/brand/` | `docs/assets/og/*.html`, renderizado por `scripts/render-og.mjs` |

Regeneração: `python scripts/site-images.py` (não altera os originais). Todo `<img>` tem `alt`
real (as legendas do README) e `width`/`height`.

## Nunca

- Segundo acento (o limão do Ops fica no Ops; o verde/âmbar/vermelho são só estado).
- Travessão ou hífen solto como pontuação, em português e em inglês.
- Depoimento, número de usuários ou logo de cliente: o que existe é "em uso desde 14/09/2026,
  sete rotinas migradas do Agendador do Windows".
- Caminho absoluto começando em `/`: a página tem de servir na raiz e em subpasta.
