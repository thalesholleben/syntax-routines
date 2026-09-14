# Desenhar uma rotina que vale a pena

Leia antes de propor uma rotina nova. O objetivo é devolver tempo ao usuário, não encher o
painel de coisas que rodam sem ninguém olhar.

## Escolher o executor

| Situação | Executor |
| --- | --- |
| Já existe script, `.ps1`, `.py` ou comando que faz o trabalho | `SCRIPT`. Mais barato, mais previsível, sem cota |
| O trabalho exige ler, decidir, escrever texto ou mexer em código | `CLAUDE` ou `CODEX` |
| O trabalho já roda no Agendador do Windows | `SCRIPT` com o mesmo comando e diretório |

Agente é o caro e o imprevisível: use quando a decisão for o trabalho. Uma esteira que só
chama scripts em ordem é rotina de script, mesmo que um dos passos chame um agente por
dentro.

Entre Claude e Codex, siga o que o usuário já usa naquele projeto. `isFallbackEnabled`
troca de agente quando o dele bate no limite de uso; deixe ligado quando o horário importa
mais que o modelo, desligado quando o resultado depende do agente específico.

## Horário

- Relatório do dia anterior: de manhã cedo, antes de ele começar (07:00 às 09:00).
- Fechamento do dia: no fim da tarde, com margem para ele ler antes de parar.
- Esteira de publicação ou fila: por intervalo, e o prompt confere se há o que fazer.
- Conferência (backup, CI, saúde de serviço): uma vez por dia, cedo, para sobrar o dia
  inteiro para consertar.
- Nunca no minuto redondo em que ele está sempre no PC fazendo outra coisa pesada, se a
  rotina for demorada e concorrer com o trabalho dele.

`missedPolicy`: `RUN_ON_BOOT` para o que precisa acontecer naquele dia (relatório, conferência);
`SKIP` para o que perde o sentido fora da hora (publicação de horário, lembrete).

## Timeout

Meça pelo pior caso conhecido e dobre. Agente com pesquisa e escrita costuma pedir 60 min;
script de arquivo local, 15 a 20. Timeout curto demais gera falha e e-mail toda vez; longo
demais deixa rotina travada segurando a fila.

## O prompt de uma rotina de agente

Rotina roda sem ninguém olhando e **nova tentativa executa o prompt inteiro de novo**. Um
prompt de rotina precisa de:

1. **Onde estão os dados** e onde vai a saída, por caminho relativo ao diretório da rotina.
2. **Como saber se já foi feito hoje**, e a ordem explícita de não fazer duas vezes.
   Exemplo: "se `relatorios/AAAA-MM-DD.md` já existir, não faça nada".
3. **O que fazer quando não houver nada a fazer**: terminar em silêncio, sem inventar
   trabalho.
4. **O limite**: o que ela não pode tocar (não publicar, não enviar, não apagar, não commitar).
5. Nada de segredo escrito no prompt. O prompt manda ler do `.env` do projeto.

O que o agente escreve na saída vira o histórico da execução; o e-mail de falha leva o erro.
Peça uma última linha curta dizendo o que foi feito: é o que aparece no painel.

## Catálogo para sugerir

Ideias que costumam valer, para você reconhecer a oportunidade na conversa:

| O que | Executor | Quando |
| --- | --- | --- |
| Resumo do dia anterior de um cliente ou campanha | agente | dias úteis de manhã |
| Varredura de repositório: dependência quebrada, teste vermelho, TODO antigo | agente | uma vez por semana |
| Conferir se o backup rodou e avisar se não | script | todo dia cedo |
| Esteira de publicação que já existe em script | script | por intervalo |
| Limpeza de pasta temporária, log velho, build antigo | script | fim de semana |
| Conferir se um serviço no ar responde | script | por intervalo |
| Preparar rascunho para ele revisar (não publicar) | agente | véspera |
| Fechar o dia: o que mudou no projeto, em três linhas | agente | fim da tarde |

Em todas, o teste é o mesmo: o resultado cai em um lugar que ele abre, ou alguém é avisado.
Se a resposta for "fica no log", não sugira.

## Quando NÃO agendar

- A decisão muda a cada vez (o que publicar, o que responder, quanto cobrar).
- O trabalho tem efeito externo irreversível sem ele ver antes (enviar, publicar, pagar,
  apagar dado de cliente). Agende a preparação, não o disparo.
- É pedido único, ou a repetição é incerta. Espere a segunda vez.
- Depende de coisa que o PC não tem: rotina não roda com o PC desligado nem sem o usuário
  logado no Windows.
- Já existe rotina parecida. Ajuste a que existe.

## Depois de criar

Proponha `run-now` na hora e leia o resultado com `runs` e `log`. Uma rotina que só vai
aparecer amanhã de manhã, e falha calada na primeira vez, custa um dia inteiro. Se o e-mail
de aviso ainda não estiver cadastrado em Ajustes (`settings` mostra), avise: sem ele, falha
não chega a ninguém.
