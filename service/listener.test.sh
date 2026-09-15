#!/bin/sh
# Teste de runtime do listener.sh (macOS e Linux): processos reais escutando uma porta efemera. Nao precisa de sudo.
# Espelha o listener.test.ps1: so o node que executa o entry DESTE projeto como script pode ser encerrado. Os casos
# cobrem as formas de um processo alheio carregar o caminho do entry sem estar rodando ele, e o entry com espaco no
# caminho, que no Mac e comum ("~/Meus Projetos").
#   sh service/listener.test.sh
set -u
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
. "$here/listener.sh"

node_abs=$(command -v node)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/sr-listener-XXXXXX")
app_entry="$tmp/com espaco/syntax-routines/dist/server/index.mjs"
other_entry="$tmp/outro-produto/dist/server/index.mjs"
sibling_entry="$tmp/com espaco/syntax-routines-old/dist/server/index.mjs"
preload="$tmp/preload.cjs"
server_source="import http from 'node:http'; http.createServer((q, s) => s.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');"
inline_source="require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.argv[1]),'127.0.0.1')"
for file in "$app_entry" "$other_entry" "$sibling_entry"; do
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$server_source" > "$file"
done
printf '%s\n' "// preload vazio" > "$preload"

failures=0
started=""

cleanup() {
  for pid in $started; do kill -9 "$pid" 2>/dev/null || true; done
  rm -rf "$tmp"
}
trap cleanup EXIT

assert_that() {
  if [ "$1" = "0" ]; then
    echo "ok  $2"
  else
    echo "FALHOU  $2"
    failures=$((failures + 1))
  fi
}

port=$(node -e "const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })")

wait_port() {
  attempt=0
  while [ "$attempt" -lt 80 ]; do
    current=$(sr_port_pid "$port")
    if [ "$1" = "escutando" ] && [ -n "$current" ]; then return 0; fi
    if [ "$1" = "livre" ] && [ -z "$current" ]; then return 0; fi
    sleep 0.15
    attempt=$((attempt + 1))
  done
  echo "a porta $port nao chegou ao estado $1" >&2
  exit 1
}

is_alive() {
  kill -0 "$1" 2>/dev/null
}

# alheio TITULO -- comando...: o processo continua vivo e o status e "outro".
alheio() {
  title=$1
  shift 2
  "$@" &
  pid=$!
  started="$started $pid"
  wait_port escutando
  status=$(sr_stop_listener "$port" "$app_entry" | cut -d' ' -f1)
  [ "$status" = "outro" ]; assert_that $? "$title : status outro"
  is_alive "$pid"; assert_that $? "$title : processo continua vivo"
  kill -9 "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
  wait_port livre
}

# proprio TITULO -- comando...: o processo e encerrado e o status e "encerrado".
proprio() {
  title=$1
  shift 2
  "$@" &
  pid=$!
  started="$started $pid"
  wait_port escutando
  status=$(sr_stop_listener "$port" "$app_entry" | cut -d' ' -f1)
  [ "$status" = "encerrado" ]; assert_that $? "$title : status encerrado"
  wait "$pid" 2>/dev/null
  wait_port livre
  if is_alive "$pid"; then assert_that 1 "$title : processo encerrado"; else assert_that 0 "$title : processo encerrado"; fi
}

alheio "node de outro produto" -- node "$other_entry" "$port"
alheio "pasta irma com o mesmo prefixo" -- node "$sibling_entry" "$port"
alheio "entry como argumento de outro script" -- node "$other_entry" "$port" "$app_entry"
alheio "codigo inline com -e e o entry como argumento" -- node -e "$inline_source" "$port" "$app_entry"
alheio "codigo inline com --eval= e o entry como argumento" -- node "--eval=$inline_source" "$port" "$app_entry"
alheio "flag fora da lista (--require=) antes do entry" -- node "--require=$preload" "$app_entry" "$port"

proprio "o proprio Syntax Routines, com espaco no caminho" -- node "$app_entry" "$port"
proprio "o proprio app com a flag do lancador" -- node --disable-warning=ExperimentalWarning "$app_entry" "$port"
proprio "o proprio app pelo caminho absoluto do node" -- "$node_abs" --disable-warning=ExperimentalWarning "$app_entry" "$port"

# perl e o que existe nos tres sistemas sem depender de mais nada (no runner do macOS o python3 nao subiu).
if command -v perl >/dev/null 2>&1; then
  alheio "processo que nao e node" -- perl -e 'use IO::Socket::INET; my $server = IO::Socket::INET->new(LocalAddr => "127.0.0.1", LocalPort => $ARGV[0], Listen => 5, ReuseAddr => 1) or die "sem socket: $!"; sleep 300;' "$port"
else
  assert_that 1 "processo que nao e node : perl ausente, caso nao executado"
fi

status=$(sr_stop_listener "$port" "$app_entry")
[ "$status" = "livre" ]; assert_that $? "porta livre : status livre"

if [ "$failures" -gt 0 ]; then
  echo "listener.test: $failures falha(s)"
  exit 1
fi
echo "listener.test: verde"
