# Registro de namespaces CSS

O visual é feito com utilitários do Tailwind v4 direto no JSX, sobre os tokens do bloco `@theme` de
`client/src/index.css` (identidade copiada do Syntax Ops). Não existe raiz de componente em CSS próprio:
componente novo continua em utilitários, e só entra classe aqui se precisar de CSS que o Tailwind não cobre.

Classes próprias, todas utilitárias (`@layer utilities` em `client/src/index.css`):

| Classe | Para |
| --- | --- |
| `spin` | giro do spinner |
| `pulse-dot` | ponto pulsante de "executando" |
| `float-orb`, `float-orb-slow` | orbs do fundo da tela de login |
| `tabular` | números alinhados (datas, contadores) |
| `text-gradient` | trecho em gradiente do título do login |
| `glass` | cartão translúcido sobre os orbs |
| `card-hover` | elevação no hover dos cartões do login |
| `pulse-glow` | halo do cartão da rotina em execução |
| `stagger` | entrada escalonada da lista de rotinas |

Todas respeitam `prefers-reduced-motion` pelo bloco no fim do arquivo.

## Dashboard

`sr-dashboard` e filhos `sr-dashboard__*` pertencem a `pages/DashboardPage.tsx` e
`pages/dashboard.css`. Modificador `is-filled` só nas vagas ocupadas. Estados de
gráfico usam `data-tone` e seleção usa `aria-pressed`. Sem animação contínua nova.
