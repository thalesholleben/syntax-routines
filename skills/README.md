# Skill do Syntax Routines para agentes

**Um agente não usa o Syntax Routines enquanto uma destas não estiver instalada.** Instalar o
app dá a ele o CLI; a skill é o que diz quando usar, como montar uma rotina que não se
atropela, e que sugerir é obrigação mas criar sem a sua confirmação não é permitido. Sem
ela, o agente ignora o app ou inventa uma tarefa no Agendador do Windows por fora.

São dois pacotes, um por cliente. Instale o que você usa; não há motivo para instalar os dois.

| Cliente | Pacote | Invocação |
| --- | --- | --- |
| Claude Code | [`claude-code/`](claude-code/skills/syntax-routines/SKILL.md) | `/syntax-routines <pedido>` |
| Codex | [`codex/`](codex/syntax-routines/SKILL.md) | `$syntax-routines <pedido>` |

## Instalar

### Claude Code, direto deste repositório (sem clonar)

No Claude Code:

```
/plugin marketplace add thalesholleben/syntax-routines
/plugin install syntax-routines@syntax-routines
```

### Qualquer um dos dois, a partir de um clone

```powershell
git clone --depth 1 https://github.com/thalesholleben/syntax-routines.git
cd syntax-routines
node scripts/install-skill.mjs claude-code   # ou: codex
```

Já tem o app instalado? A pasta dele é o clone: rode o comando lá dentro.

Instala para o seu usuário, em `~/.claude/skills/syntax-routines` ou
`~/.agents/skills/syntax-routines`. Com `--project`, instala na pasta atual, quando só um
projeto deve usar. Se já existir uma instalação, ele recusa e só substitui com `--force`,
para nunca apagar em silêncio uma cópia que você editou. O script não instala dependência
nenhuma.

### Na mão

Copie a pasta `syntax-routines` da sua variante para um destes lugares:

| Cliente | Só este projeto | Seu usuário |
| --- | --- | --- |
| Claude Code | `.claude/skills/syntax-routines/` | `~/.claude/skills/syntax-routines/` |
| Codex | `.agents/skills/syntax-routines/` | `~/.agents/skills/syntax-routines/` |

## Depois de instalar

A skill não instala o app e não configura nada: ela descobre a instalação pela tarefa
agendada `SyntaxRoutines` e usa o `routines.cmd` que já está lá. Se o app ainda não existe
neste PC, o caminho é o `README.pt-BR.md` da raiz (`.\service\install.ps1 -Build`), e quem cria a
senha do painel, escolhe a pasta mãe e cadastra o e-mail de aviso é você, uma vez.

Sem instalação utilizável, a skill diz que a rotina **não foi cadastrada** e o que falta. Ela
não cria tarefa no Agendador do Windows como substituto, não escreve no banco por fora do
CLI e não pede a senha do painel.

## O que a skill ensina

- Reconhecer trabalho repetido na conversa e propor a rotina antes de você pedir, com o que
  ela faz, quando roda e o que ela **não** faz.
- Escolher entre agente e script, o horário, o timeout e a política de PC desligado.
- Escrever um prompt de rotina que pode ser executado de novo sem fazer duas vezes.
- Provar a rotina na hora com `run-now`, `runs` e `log`, em vez de deixar para amanhã.
- Desligar antes de apagar, e sugerir desligar o que virou ruído.

Autorização é por alteração: um "pode criar" não vale para a rotina seguinte, nem para
alterar ou apagar outra.

## Como isto se mantém honesto

O pacote documenta o CLI deste repositório, então envelhece no dia em que um comando muda.
Por isso ele mora aqui, e não em um repositório próprio: a mudança do CLI e a atualização da
skill são o mesmo commit. `npm run skills:check` roda no CI e reprova quando

- `references/cli.md` ou `references/rotinas.md` deixam de ser idênticos entre as duas
  variantes (`setup.md` difere de propósito, porque instalar difere por cliente);
- um comando citado em `cli.md` não existe no `--help` do CLI de verdade, ou um comando do
  CLI não está documentado;
- o registro do marketplace e o manifesto do plugin discordam, ou apontam para o nada.

Mudou o CLI, atualize a referência e deixe o gate confirmar. O `--help` do CLI vale mais que
este texto se os dois divergirem.
