#!/bin/sh
# Remove o servico de login e o atalho do Syntax Routines no macOS e no Linux. Os dados em data/ (rotinas, historico,
# logs) ficam. Nao precisa de sudo: o servico e do proprio usuario.
#   ./service/uninstall.sh
set -eu

PORT=4090
LABEL="br.com.syntaxlab.syntax-routines"
UNIT="syntax-routines.service"

project=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
entry="$project/dist/server/index.mjs"
system=$(uname -s)
. "$project/service/listener.sh"

case "$system" in
  Darwin)
    uid=$(id -u)
    removed=0
    for domain in "gui/$uid" "user/$uid"; do
      if launchctl bootout "$domain/$LABEL" 2>/dev/null; then removed=1; fi
    done
    plist="$HOME/Library/LaunchAgents/$LABEL.plist"
    [ -f "$plist" ] && rm -f "$plist" && removed=1
    if [ "$removed" = "1" ]; then echo "LaunchAgent '$LABEL' removido."; else echo "LaunchAgent '$LABEL' nao existe."; fi
    rm -rf "$HOME/Applications/Syntax Routines.app" && echo "Atalho removido."
    ;;
  Linux)
    unit_file="$HOME/.config/systemd/user/$UNIT"
    if systemctl --user show-environment >/dev/null 2>&1; then
      systemctl --user disable --now "$UNIT" 2>/dev/null || true
    fi
    if [ -f "$unit_file" ]; then
      rm -f "$unit_file"
      systemctl --user daemon-reload 2>/dev/null || true
      echo "Unit '$UNIT' removida."
    else
      echo "Unit '$UNIT' nao existe."
    fi
    desktop="$HOME/.local/share/applications/syntax-routines.desktop"
    [ -f "$desktop" ] && rm -f "$desktop" && echo "Atalho removido."
    ;;
  *)
    echo "Sistema nao suportado por este script: $system. No Windows use service\\uninstall.ps1." >&2
    exit 1
    ;;
esac

# Parar o servico derruba o processo, mas uma instancia solta (start.sh) pode continuar na porta. So a do app e encerrada.
listener=$(sr_stop_listener "$PORT" "$entry")
case "$listener" in
  encerrado*) echo "Syntax Routines (PID $(echo "$listener" | cut -d' ' -f2)) na porta $PORT encerrado." ;;
  outro*) echo "A porta $PORT esta com outro processo ($(echo "$listener" | cut -d' ' -f2-)); ele nao foi tocado." ;;
esac

echo "Dados preservados em $project/data."
