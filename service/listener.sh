# Quem escuta na porta do Syntax Routines, e se e o proprio app. Usado por install.sh e uninstall.sh (macOS e Linux),
# com a mesma regra do listener.ps1: so pode ser encerrado o node que esta EXECUTANDO o dist/server/index.mjs DESTE
# projeto como script. Qualquer outro processo fica intocado e conta como porta ocupada.
#
# Lista fechada do que pode vir antes do entry: so a flag que os lancadores usam (start.sh, npm start, LaunchAgent e
# unit do systemd). Opcao arbitraria do node nao entra, porque pode executar codigo (`-e`, `--eval=`, `-p`) ou consumir
# o argumento seguinte (`--require`, `--import`), e nesse caso o entry seria argumento inerte de outro programa.
# Mudou a flag do lancador? Acrescente aqui e cubra no listener.test.sh.
#
# POSIX sh (dash, bash, o sh do macOS). Funcoes e variaveis com prefixo sr_ porque o arquivo e carregado com `.`.

# PID de quem escuta em 127.0.0.1:PORTA; vazio quando ninguem escuta.
sr_port_pid() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP@127.0.0.1:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :$1" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1
  else
    echo "listener.sh: sem lsof nem ss para descobrir quem usa a porta $1" >&2
    return 2
  fi
}

# Linha de comando do processo, argumentos separados por espaco. Linux: /proc; macOS: ps.
sr_process_args() {
  if [ -r "/proc/$1/cmdline" ]; then
    tr '\000' ' ' < "/proc/$1/cmdline" | sed 's/ $//'
  else
    ps -o args= -p "$1" 2>/dev/null
  fi
}

# Nome do executavel do processo (sem a pasta).
sr_process_name() {
  if [ -e "/proc/$1/exe" ]; then
    sr_exe=$(readlink "/proc/$1/exe" 2>/dev/null) || return 1
  else
    sr_exe=$(ps -o comm= -p "$1" 2>/dev/null) || return 1
  fi
  basename "$sr_exe"
}

# Sucesso so quando o processo e o node rodando ENTRY como script: `<node> [--disable-warning=X]... ENTRY [args]`.
# A comparacao do entry e literal (index do awk, sem regex), entao caminho com espaco, ponto ou colchete funciona.
sr_is_routines_server() {
  [ "$(sr_process_name "$1")" = "node" ] || return 1
  sr_process_args "$1" | awk -v entry="$2" '
    NR > 1 { exit 1 }
    {
      start = index($0, " " entry)
      if (start == 0) exit 1
      prefix = substr($0, 1, start - 1)
      rest = substr($0, start + 1 + length(entry))
      if (rest != "" && substr(rest, 1, 1) != " ") exit 1
      if (prefix !~ /^([^ ]*\/)?node( --disable-warning=[^ ]+)*$/) exit 1
      found = 1
    }
    END { exit found ? 0 : 1 }'
}

# Imprime "livre", "encerrado <pid>" ou "outro <pid> <linha de comando>". So encerra o proprio app.
sr_stop_listener() {
  sr_pid=$(sr_port_pid "$1") || return 2
  if [ -z "$sr_pid" ]; then
    echo "livre"
    return 0
  fi
  if sr_is_routines_server "$sr_pid" "$2"; then
    kill "$sr_pid" 2>/dev/null || true
    sr_wait=0
    while kill -0 "$sr_pid" 2>/dev/null && [ "$sr_wait" -lt 50 ]; do
      sleep 0.1
      sr_wait=$((sr_wait + 1))
    done
    kill -9 "$sr_pid" 2>/dev/null || true
    echo "encerrado $sr_pid"
  else
    echo "outro $sr_pid $(sr_process_args "$sr_pid")"
  fi
}
