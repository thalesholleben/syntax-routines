# Dashboard operacional

Terceira tela do painel, em PT e EN. `GET /api/dashboard?hours=24|168|720` fica
no router autenticado. Consulta somente leitura; o único toque no banco é o índice
`runs_ended` pela expressão de término (`db.ts`), criado no `openDb`, que evita a
varredura completa de `runs` a cada atualização (100 mil execuções: 53 ms para 18 ms). A tela
atualiza a cada cinco segundos após a resposta, ou trinta segundos quando oculta.
Falhas de atualização preservam a última fotografia com aviso visível.

## Métricas

Histórico usa `(início, fim]`, pelo término; puladas sem término usam `created_at`,
assim como a retenção existente. Taxa de erro = FAILED / (SUCCEEDED + FAILED).
Canceladas e puladas são contadas separadamente. Média usa somente sucessos e
falhas com início registrado. Sem amostra, média e taxa ficam indisponíveis.
Comparação usa uma janela anterior de igual tamanho; a retenção de 30 dias pode
deixar essa base incompleta. As 24 barras cobrem todo o período selecionado.

## Estado atual e previsão

Fila, vagas e rotinas ativas independem do filtro histórico. O sinal do agendador
fica em alerta após 90 segundos sem tick. A previsão reutiliza `nextOccurrence`
e `occurrencesBetween`, no fuso local do servidor, sem alterar o agendador.
Mostra todas as ocorrências nas contagens das três pistas e apenas as primeiras
12 na lista geral e em cada faixa. Rotinas pausadas ficam fora da previsão.
A próxima rotina pode estar além das próximas 24 horas.

Limites de apresentação: 100 execuções ativas, 50 resultados recentes e oito
rotinas com mais falhas. Os totais não sofrem esses cortes. Prompts, comandos,
resultados completos e logs não entram na consulta agregada. O botão de log usa
o modal existente e o endpoint `/api/runs/:id`.

## Validação

`npm run typecheck`, `npm test`, `npm run build`, `npm run e2e`.
`dashboard.test.ts` cobre períodos, fronteiras, ausência de escrita, resultados
pulados, dados vazios e 100 rotinas por intervalo. `app.test.ts` verifica sessão,
janela inválida e contrato HTTP. O smoke verifica PT/EN, faixa, período, logs e
360/768/1280px com banco temporário e executores falsos.

`npx tsx e2e/dashboard.ts` acrescenta revisão com 100 rotinas e 3005 registros,
fila ativa, perda de conexão, recuperação e estado vazio, sem iniciar agendador.
As imagens e o HTML renderizado ficam em `e2e/.output/`, fora do Git.

Revisão visual: identidade, hierarquia e alinhamento conferidos nas capturas.
O verificador de CSS não encontrou colisões. O verificador estático de frontend
reconhece as duas fontes, mas sinaliza repetição de seções: este dashboard mantém
cabeçalhos de painéis consistentes, com conteúdos distintos (mapa, fila, gráfico,
agenda, tabela e ranking). Essa composição foi mantida após inspeção no Chrome.
