# CLI do Syntax Routines

Leia antes do primeiro comando. O CLI lê e escreve o mesmo banco do app, com a mesma
validação das rotas da API: o que ele recusa, o painel também recusaria.

`<projeto>` é a pasta que você descobriu em [setup.md](setup.md). Os exemplos usam o wrapper
`routines.cmd`, que já chama o build certo:

```powershell
& "<projeto>\routines.cmd" list
```

No macOS e no Linux o wrapper é `routines.sh`, com os mesmos comandos e as mesmas opções:

```bash
"<projeto>/routines.sh" list
```

Sem o build (repositório clonado, app não instalado), o equivalente é
`npm run routines -- list` dentro da pasta do projeto.

## Comandos

| Comando | O que faz |
| --- | --- |
| `list [--json]` | rotinas cadastradas, com agenda, próxima execução e como terminou a última |
| `show <id> [--json]` | uma rotina inteira, com o prompt ou o comando completo |
| `settings [--json]` | pasta mãe, e-mail de aviso, estado do envio (conectado, falhou ou não testado, sem senha), estado do agendador e os valores aceitos |
| `runs <id> [--limit N] [--json]` | histórico de execuções da rotina, da mais recente para a mais antiga |
| `log <execução> [--tail N]` | saída de uma execução (o mesmo log que o painel mostra) |
| `add <rotina.json>` | cria uma rotina |
| `edit <id> <patch.json>` | altera só os campos presentes no arquivo |
| `enable <id>` / `disable <id>` | liga e desliga a rotina |
| `run-now <id>` | põe uma execução manual na fila |
| `rm <id> --forca` | apaga a rotina e todo o histórico dela |

Opções gerais: `--data <pasta>` (outra pasta de dados) e `--json` nas leituras.
`--json` devolve exatamente o que a API devolveria, e nada mais vai para a saída padrão.

Os cinco últimos são escrita e exigem a confirmação do usuário para aquela alteração.
Sai `0` quando dá certo, `1` em erro de uso ou regra (a mensagem diz qual) e `2` quando o
comando não existe.

## O arquivo de uma rotina

`add` recebe um objeto JSON com os catorze campos. Campo que não existe na lista é erro,
não é ignorado em silêncio.

```json
{
  "name": "Resumo diário do Google Ads",
  "agentKind": "CLAUDE",
  "directory": "clientes/loja",
  "model": "claude-opus-5",
  "effort": "high",
  "timeoutMinutes": 60,
  "isFallbackEnabled": true,
  "days": [1, 2, 3, 4, 5],
  "time": "09:00",
  "intervalMinutes": null,
  "prompt": "Leia as campanhas de ontem e grave o resumo em relatorios/AAAA-MM-DD.md. Se o arquivo de hoje já existir, não faça nada.",
  "command": "",
  "missedPolicy": "RUN_ON_BOOT",
  "isEnabled": true
}
```

| Campo | Regra |
| --- | --- |
| `name` | 1 a 80 caracteres. Repetido confunde na lista e no e-mail |
| `agentKind` | `CLAUDE`, `CODEX` ou `SCRIPT` |
| `directory` | absoluto ou relativo à pasta mãe. Fora dela, ou pasta do sistema, é recusado |
| `model` | um dos modelos do agente (veja `settings`), ou `null` para o padrão do CLI. Em `SCRIPT`, sempre `null` |
| `effort` | da lista do agente. Em `SCRIPT`, string vazia |
| `timeoutMinutes` | 15 a 240. Estourou, a execução falha e avisa |
| `isFallbackEnabled` | `true` troca de agente quando o outro está no limite de uso. Só faz sentido em agente |
| `days` | 0 é domingo, 6 é sábado. Pelo menos um |
| `time` | `HH:MM` local. Ignorado quando há intervalo |
| `intervalMinutes` | `null` para hora fixa, ou um dos valores de `settings` (5 min a 12 h) |
| `prompt` | o que o agente vai fazer. Vazio em `SCRIPT` |
| `command` | uma linha, como no cmd (`%VAR%` expande). Vazio em agente |
| `missedPolicy` | `SKIP` ou `RUN_ON_BOOT`, para quando o PC estava desligado no horário |
| `isEnabled` | `false` cadastra sem deixar rodar |

Rotina por intervalo ignora `missedPolicy`: a ocorrência perdida é descartada e a próxima
vem em no máximo um intervalo.

## Alterar sem reescrever

`edit` mescla o patch sobre o que está gravado; o que não veio no arquivo fica como estava.

```powershell
'{ "time": "07:30", "days": [1, 3, 5] }' | Set-Content -Encoding utf8 patch.json
& "<projeto>\routines.cmd" edit 4 patch.json
```

Trocar `agentKind` limpa o que era do executor anterior (prompt, modelo, effort, fallback ou
comando), então mande no mesmo patch o que o novo executor precisa.

Texto com acento, aspas ou `$` vai para o arquivo por escrita de arquivo, nunca montado
inline no shell.

## Ler execução

```powershell
& "<projeto>\routines.cmd" runs 4 --limit 5
& "<projeto>\routines.cmd" log 187 --tail 60
```

`runs` mostra id, desfecho, quando, duração e se foi manual ou agendada, com a primeira
linha do erro quando falhou. `log` traz o cabeçalho da execução (desfecho, código de saída,
duração, nota e erro) e o fim do arquivo de log.

Estados: `na fila`, `rodando`, `concluída`, `falhou`, `pulada` (PC desligado com política de
pular, ou substituída por uma ocorrência mais recente) e `cancelada`.

## Executar agora

```powershell
& "<projeto>\routines.cmd" run-now 4
```

Põe uma execução manual na fila e devolve o id dela. Quem despacha é o app, no próximo tick
(até 30 s). Se o CLI avisar que o app não confere a fila há um tempo, o Syntax Routines não
está rodando: peça para o usuário abrir o atalho.

Uma rotina não roda duas vezes ao mesmo tempo: com execução na fila ou rodando, `run-now`
recusa em vez de enfileirar outra.

## Erros comuns

| Mensagem | O que fazer |
| --- | --- |
| `banco não encontrado em ...` | app não instalado nessa pasta; confira o caminho em [setup.md](setup.md) |
| `defina a pasta mãe em Ajustes` | o usuário precisa configurar a pasta mãe no painel, uma vez |
| `Diretório fora da pasta mãe` | escolha um diretório dentro dela; mudar a pasta mãe é decisão dele |
| `Esse modelo não existe para o agente escolhido` | use um valor de `settings` |
| `Esta rotina já tem uma execução na fila ou rodando` | espere terminar; veja `runs <id>` |
| `Cancele a execução na fila ou rodando antes de excluir` | cancele no painel e tente de novo |
