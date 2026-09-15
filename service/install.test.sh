#!/bin/sh
# Teste do gerador de servico do install.sh (macOS e Linux): a unit do systemd e o plist do launchd
# precisam sobreviver a um caminho de projeto com espaco e com %, que o systemd trata como
# especificador (%h, %i). O teste copia o projeto para um caminho assim e confere o que sai.
#   sh service/install.test.sh
set -u
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
project=$(CDPATH='' cd -- "$here/.." && pwd)

failures=0
tmp=$(mktemp -d "${TMPDIR:-/tmp}/sr-install-XXXXXX")
trap 'rm -rf "$tmp"' EXIT

assert_that() {
  if [ "$1" = "0" ]; then
    echo "ok  $2"
  else
    echo "FALHOU  $2"
    failures=$((failures + 1))
  fi
}

# Copia so o necessario para o --print-*: os scripts e um entry de mentira.
fake="$tmp/pasta com espaco e 100% de risco/syntax-routines"
mkdir -p "$fake/service" "$fake/dist/server"
cp "$project/service/install.sh" "$project/service/listener.sh" "$fake/service/"
: > "$fake/dist/server/index.mjs"

unit="$tmp/unit.service"
plist="$tmp/service.plist"
(cd "$fake" && sh service/install.sh --print-unit) > "$unit"
(cd "$fake" && sh service/install.sh --print-plist) > "$plist"

# Na unit, todo % literal vira %%: WorkingDirectory, ExecStart e o PATH.
grep -q 'WorkingDirectory=.*100%% de risco' "$unit"
assert_that $? "unit: WorkingDirectory com % dobrado"
grep -q 'ExecStart=.*100%% de risco.*index.mjs' "$unit"
assert_that $? "unit: ExecStart com % dobrado"
if grep -E '^(WorkingDirectory|ExecStart)=' "$unit" | grep -q '[^%]%[^%]'; then
  assert_that 1 "unit: nenhum % solto nos caminhos"
else
  assert_that 0 "unit: nenhum % solto nos caminhos"
fi
grep -q 'ExecStart="[^"]*node" --disable-warning=ExperimentalWarning "' "$unit"
assert_that $? "unit: caminho com espaco entre aspas no ExecStart"

# O plist e XML: o caminho entra cru (% nao e especial la), e precisa continuar valido.
grep -q '100% de risco' "$plist"
assert_that $? "plist: caminho com % e espaco preservado"
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$plist" >/dev/null 2>&1
  assert_that $? "plist: plutil -lint aprova"
elif command -v python3 >/dev/null 2>&1; then
  python3 -c "import sys, xml.dom.minidom; xml.dom.minidom.parse(sys.argv[1])" "$plist" >/dev/null 2>&1
  assert_that $? "plist: XML bem formado"
else
  echo "ok  plist: sem plutil nem python3, validacao de XML pulada"
fi

# Caminho com aspas nao tem escape possivel na unit nem no plist: o instalador recusa antes de escrever.
quoted="$tmp/pasta com \"aspas\"/syntax-routines"
mkdir -p "$quoted/service" "$quoted/dist/server"
cp "$project/service/install.sh" "$project/service/listener.sh" "$quoted/service/"
: > "$quoted/dist/server/index.mjs"
if (cd "$quoted" && sh service/install.sh --print-unit) >/dev/null 2>&1; then
  assert_that 1 "caminho com aspas e recusado"
else
  assert_that 0 "caminho com aspas e recusado"
fi

if [ "$failures" -gt 0 ]; then
  echo "install.test: $failures falha(s)"
  exit 1
fi
echo "install.test: verde"
