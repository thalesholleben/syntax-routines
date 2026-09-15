# Primeira execução no macOS (e no Linux)

O que o CI em `macos-latest` e `ubuntu-latest` **não** consegue provar, e que alguém com um Mac de
verdade precisa conferir uma vez para o macOS deixar de ser beta. Enquanto este roteiro não for
cumprido, o README diz "beta" no macOS e "experimental" no Linux, e isso é proposital.

## O que o CI já prova a cada commit

- `npm run typecheck`, `npm test` (inclusive o cofre de senha real e a morte do grupo de processos),
  `npm run build`, `npm run e2e` no Chrome, `npm run test:sh` e `npm run skills:check`.
- No macOS: `service/install.sh` registra o LaunchAgent, o app responde em `http://127.0.0.1:4090/`,
  o bundle `~/Applications/Syntax Routines.app` e o plist passam no `plutil -lint`, e o
  `service/uninstall.sh` desfaz tudo.
- No Linux: a unit gerada é verificada, e a instalação de verdade roda quando o runner tem sessão
  `systemd --user`.

## O que falta conferir num Mac de verdade

Marque cada item; o que falhar vira issue com o sistema, a versão do macOS e o trecho de
`data/service.log`.

1. **Instalação.** `./service/install.sh --build` em um terminal comum, sem `sudo`, numa pasta cujo
   caminho tenha espaço (`~/Meus Projetos/syntax-routines`) para exercitar o caminho citado.
2. **Sobe sozinho no login.** Reinicie o Mac, faça login e confira, sem abrir nada:
   `launchctl print gui/$(id -u)/br.com.syntaxlab.syntax-routines | head -20` e o painel
   respondendo em `http://127.0.0.1:4090/`.
3. **Atalho.** Abrir `~/Applications/Syntax Routines.app` pelo Launchpad: tem que abrir o painel em
   janela própria (modo app), com o ícone do Syntax Routines, sem barra de endereço. Sem Chrome,
   Edge, Chromium ou Brave, ele abre no navegador padrão, em aba comum.
4. **Gatekeeper.** O bundle é criado na própria máquina, então não deve aparecer aviso de
   "desenvolvedor não identificado". Se aparecer, anote o texto exato.
5. **Cofre de senha.** Em Ajustes, **Configurar e-mail** com uma conta SMTP de teste: salvar precisa
   dizer Conectado. Confira se o macOS pediu permissão para acessar as Chaves e, se pediu, quando.
   Depois: `security find-generic-password -s syntax-routines-smtp -w` devolve um base64 (a senha
   guardada), e `sqlite3 data/app.db "select value from settings where key='smtp_pass_dpapi'"`
   devolve só `keychain:<uuid>`, nunca a senha.
6. **Remover a conta** pelo painel apaga o item do Keychain: o `find-generic-password` acima passa a
   não achar nada.
7. **Agentes de verdade.** Uma rotina de Claude Code e uma de Codex, com `claude` e `codex` logados
   no seu usuário, rodando pelo serviço (não pelo terminal): o `PATH` gravado na instalação precisa
   achar os dois. Rode "Executar agora" e confira a saída no painel.
8. **Rotina de script.** Um comando com `&&` e outro que sai com código diferente de 0: o segundo
   tem que virar Falhou e disparar o aviso por e-mail.
9. **Timeout mata a árvore.** Rotina de script `sleep 600` com timeout de 15 min não serve para o
   teste rápido: use uma rotina com timeout curto pelo painel, cancele pelo botão e confira com
   `ps -ef | grep sleep` que nada sobrou.
10. **Notebook dormindo.** Feche a tampa por mais tempo que um intervalo de rotina e confira, ao
    acordar, se a próxima execução acontece e se a política de PC desligado se comporta como no
    Windows (a rotina de horário fixo pula ou roda na volta, conforme escolhido).
11. **Desinstalar.** `./service/uninstall.sh` derruba o serviço, some com o plist e com o atalho, e
    `data/` continua lá.

## Linux, quando alguém for usar

Mesma lista, trocando launchd por `systemctl --user status syntax-routines.service`, o Keychain por
`secret-tool lookup service syntax-routines-smtp account <uuid>` e o bundle pelo atalho em
`~/.local/share/applications/syntax-routines.desktop`. Sem chaveiro de sessão (servidor sem
desktop), a senha do painel não é salva: o e-mail fica pelo `.env`, e o painel mostra o motivo.

## Arquitetura Intel (x64)

O runner do CI é Apple Silicon. Num Mac Intel, tudo deve funcionar igual (o app é Node puro, sem
binário nativo próprio), mas ninguém rodou: se for o seu caso, anote o resultado na issue.
