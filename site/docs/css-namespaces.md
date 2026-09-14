# Registro de namespaces CSS · `site/`

Regras da skill `css-naming-guard`: uma raiz por componente, filhos ancorados na raiz,
modificadores só com `is-`/`has-`, nada de raiz genérica. Raiz nova entra aqui no mesmo commit.
Arquivo único de estilo: `site/css/site.css`. Verificação:
`python ~/.claude/skills/css-naming-guard/scripts/check_css.py site/index.html site/en/index.html site/css/site.css`.

| Namespace raiz | Componente | Local principal |
| --- | --- | --- |
| `lp-wrap` | container central (1120px) | utilitário, todas as seções |
| `lp-kicker` | rótulo mono com traço acima de título | utilitário, todas as seções |
| `lp-btn` | botão (`is-primary`, `is-ghost`, `is-small`) | hero, instalação, fecho, topbar |
| `lp-topbar` | cabeçalho fixo com marca, âncoras, idioma e GitHub | topo |
| `lp-hero` | hero com copy, CTAs, prova curta e captura inclinada | seção 1 |
| `lp-days` | grade de dias SEG..DOM (dispositivo assinatura; `is-live` anima) | hero, faixa |
| `lp-audience` | faixa "para quem é" | seção 2 |
| `lp-pain` | dor → o que muda, em linhas numeradas | seção 3 |
| `lp-steps` | como funciona em três passos (trilha) | seção 4 |
| `lp-kinds` | os três tipos de rotina (cards com marca do provedor) | seção 5 |
| `lp-band` | faixa de princípio no acento com a grade de dias | seção 6 |
| `lp-agent` | o agente cuida: terminal + skill | seção 7 |
| `lp-shots` | galeria de capturas em degrau | seção 8 |
| `lp-install` | instalação em uma linha (painel terminal) | seção 9 |
| `lp-faq` | perguntas frequentes (`<details>`) | seção 10 |
| `lp-close` | fecho com captura ao fundo e CTA final | seção 11 |
| `lp-footer` | rodapé com SyntaxLab, MIT e produtos irmãos | rodapé |
| `fx-reveal` | entrada por scroll (`is-in`; `fx-reveal-group` para stagger) | efeito, `js/site.js` |
| `fx-veil` | véu em gradiente sobre imagem (`is-left`, `is-bottom`) | efeito |
| `fx-glow` | mancha de luz do acento | efeito |
