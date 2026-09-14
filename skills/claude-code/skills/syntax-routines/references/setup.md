# Encontrar (ou instalar) o app no Claude Code

Leia quando o CLI não responder, ou quando o usuário pedir para instalar o Syntax Routines.
Os comandos abaixo são instruções de configuração: ler esta skill não instala nada.

## Onde o app está

O instalador registra a tarefa agendada `SyntaxRoutines`, que guarda a pasta do projeto:

```powershell
(Get-ScheduledTask -TaskName SyntaxRoutines -ErrorAction SilentlyContinue).Actions[0].WorkingDirectory
```

Com o caminho em mãos, confirme que o CLI responde antes de qualquer outra coisa:

```powershell
& "<projeto>\routines.cmd" settings
```

Guarde o caminho para o resto da conversa. Não o adivinhe pelo nome de pasta, não procure
`app.db` pelo disco inteiro e não escreva no banco por fora do CLI.

Nada voltou do `Get-ScheduledTask`? Então o app não está instalado neste usuário do Windows,
ou foi instalado sem a tarefa. Pergunte ao usuário onde está a pasta do projeto antes de
concluir que ele não tem o Routines.

## Está instalado, mas o CLI reclama

| Sintoma | Causa e saída |
| --- | --- |
| `Build nao encontrado` | falta `npm run build` na pasta do projeto (ou reinstalar com `.\service\install.ps1 -Build`) |
| `banco não encontrado em ...` | o app nunca subiu nessa pasta, ou os dados estão em outra (`DATA_DIR`) |
| `defina a pasta mãe em Ajustes` | o usuário abre o painel, vai em Ajustes e escolhe a pasta mãe. Só ele faz isso |
| o CLI avisa que o agendador não confere a fila | o processo não está rodando: peça para ele abrir o atalho "Syntax Routines" |

O painel fica em `http://127.0.0.1:4090/`, com senha própria criada no primeiro acesso. Você
não precisa dela para o CLI, e não deve pedi-la.

## Instalar o app

Só quando o usuário pedir. Em um PowerShell comum (não precisa de administrador), na pasta
do projeto:

```powershell
Copy-Item .env.example .env      # e preencha o SMTP, se quiser aviso por e-mail
.\service\install.ps1 -Build
```

O script instala dependências, gera o build, registra a tarefa que sobe no logon e cria o
atalho na área de trabalho. Depois disso, o usuário cria a senha do painel e configura a
pasta mãe e o e-mail de aviso em Ajustes. Nada disso é seu para fazer por ele.

Requisitos: Windows 10 ou 11, Node.js 24.13 ou mais novo, e `claude` e `codex` instalados e
autenticados no usuário dele para as rotinas de agente.

## Limites que valem lembrar

- O app roda com o usuário logado no Windows. Tela bloqueada não atrapalha; PC desligado ou
  ninguém logado, sim.
- Rotina de agente roda com acesso total dentro da pasta mãe, sem pedir permissão. É o mesmo
  poder que você tem aqui, sem ninguém olhando: por isso a confirmação antes de criar.
- O aviso de falha depende do SMTP no `.env` e do endereço em Ajustes. Sem os dois, falha
  não avisa ninguém.

Fonte: `README.md` e `AGENTS.md` do projeto, que valem mais que este texto se divergirem.
