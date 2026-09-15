# Encontrar (ou instalar) o app no Codex

Leia quando o CLI não responder, ou quando o usuário pedir para instalar o Syntax Routines.
Os comandos abaixo são instruções de configuração: ler esta skill não instala nada.

## Onde o app está

O instalador registra o serviço de login, que guarda a pasta do projeto. No Windows:

```powershell
(Get-ScheduledTask -TaskName SyntaxRoutines -ErrorAction SilentlyContinue).Actions[0].WorkingDirectory
```

No macOS e no Linux:

```bash
plutil -extract WorkingDirectory raw ~/Library/LaunchAgents/br.com.syntaxlab.syntax-routines.plist
systemctl --user show -p WorkingDirectory --value syntax-routines.service
```

Com o caminho em mãos, confirme que o CLI responde antes de qualquer outra coisa:

```powershell
& "<projeto>\routines.cmd" settings
```

```bash
"<projeto>/routines.sh" settings
```

Guarde o caminho para o resto da conversa. Não o adivinhe pelo nome de pasta, não procure
`app.db` pelo disco inteiro e não escreva no banco por fora do CLI.

Nada voltou? Então o app não está instalado neste usuário, ou foi instalado sem o serviço. Pergunte ao usuário onde está a pasta do projeto antes de
concluir que ele não tem o Routines.

## Está instalado, mas o CLI reclama

| Sintoma | Causa e saída |
| --- | --- |
| `Build nao encontrado` | falta `npm run build` na pasta do projeto (ou reinstalar com `.\service\install.ps1 -Build`, ou `./service/install.sh --build`) |
| `banco não encontrado em ...` | o app nunca subiu nessa pasta, ou os dados estão em outra (`DATA_DIR`) |
| `defina a pasta mãe em Ajustes` | o usuário abre o painel, vai em Ajustes e escolhe a pasta mãe. Só ele faz isso |
| o CLI avisa que o agendador não confere a fila | o processo não está rodando: peça para ele abrir o atalho "Syntax Routines" |

O painel fica em `http://127.0.0.1:4090/`, com senha própria criada no primeiro acesso, em
português ou inglês (seletor na tela de login e no pé da barra lateral). Você não precisa da senha
para o CLI, e não deve pedi-la.

## Instalar o app

Só quando o usuário pedir, na pasta do projeto. No Windows, em um PowerShell comum (não precisa
de administrador):

```powershell
.\service\install.ps1 -Build
```

No macOS e no Linux, em um terminal (não precisa de `sudo`):

```bash
./service/install.sh --build
```

O script instala dependências, gera o build, registra o serviço que sobe no login (tarefa
agendada, LaunchAgent ou unit do systemd) e cria o atalho. Depois disso, o usuário cria a senha do painel e configura a
pasta mãe e o e-mail em Ajustes (botão Configurar e-mail: Gmail com senha de app ou outro
SMTP). Nada disso é seu para fazer por ele, e a senha do e-mail você nunca pede, nunca digita e
nunca grava, nem no `.env`.

Requisitos: Windows 10 ou 11, Node.js 24.13 ou mais novo, e `codex` e `claude` instalados e
autenticados no usuário dele para as rotinas de agente. Uma rotina `CODEX` usa o mesmo CLI e a
mesma conta que você usa aqui: o limite de uso é compartilhado com o trabalho dele.

## Limites que valem lembrar

- O app roda com o usuário logado (Windows, macOS ou Linux). Tela bloqueada não atrapalha; PC
  desligado ou ninguém logado, sim. No macOS e no Linux o serviço usa o `PATH` gravado na
  instalação: instalou `claude` ou `codex` depois, é preciso rodar o instalador de novo.
- Rotina de agente roda com acesso total dentro da pasta mãe, sem pedir permissão. É o mesmo
  poder que você tem aqui, sem ninguém olhando: por isso a confirmação antes de criar.
- O aviso de falha depende de uma conta que envia (Ajustes > Configurar e-mail, ou o `.env`) e
  do destinatário. `settings` mostra o estado do envio: conectado, falhou (com o motivo), não
  testado ou não configurado. Nos dois últimos casos, falha de rotina pode não avisar ninguém:
  diga isso a ele.

Fonte: `README.md` e `AGENTS.md` do projeto, que valem mais que este texto se divergirem.
