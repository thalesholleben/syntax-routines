#!/bin/sh
# Instala o Syntax Routines para subir sozinho no login do usuario, sem terminal aberto, com atalho em modo app.
#   macOS: LaunchAgent br.com.syntaxlab.syntax-routines (launchctl, dominio gui do usuario).
#   Linux: unit de usuario do systemd (systemctl --user), que exige uma sessao de usuario com systemd.
# Roda com o proprio usuario, SEM sudo: nada no app precisa de root, e agente com acesso total nao deve ganhar root
# de brinde. Os dados ficam em data/ (rotinas, historico, logs) e nao sao tocados aqui.
#
#   ./service/install.sh --build   # npm ci e npm run build antes de registrar
#   ./service/install.sh           # so registra de novo (depois de mudar o .env ou instalar claude/codex)
#   ./service/install.sh --print-plist | --print-unit   # imprime o arquivo do servico e sai, sem instalar nada
set -eu

PORT=4090
URL="http://127.0.0.1:$PORT/"
LABEL="br.com.syntaxlab.syntax-routines"
UNIT="syntax-routines.service"

project=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
entry="$project/dist/server/index.mjs"
system=$(uname -s)
build=0
print_only=""

for arg in "$@"; do
  case "$arg" in
    --build) build=1 ;;
    --print-plist) print_only="plist" ;;
    --print-unit) print_only="unit" ;;
    -h | --help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "opcao desconhecida: $arg" >&2
      exit 2
      ;;
  esac
done

node_bin=$(command -v node || true)
if [ -z "$node_bin" ]; then
  echo "node nao encontrado no PATH. Instale o Node.js 24.13 ou mais novo." >&2
  exit 1
fi
if ! "$node_bin" -e 'const [maior, menor] = process.versions.node.split(".").map(Number); process.exit(maior > 24 || (maior === 24 && menor >= 13) ? 0 : 1)'; then
  echo "Node.js 24.13 ou mais novo e necessario (achei $("$node_bin" -v))." >&2
  exit 1
fi

# O caminho do servico e fixado agora: launchd e systemd sobem com um PATH minimo, onde node, claude e codex
# normalmente nao estao. Instalou um deles depois? Rode este script de novo.
service_path=$PATH
service_lang=${LANG:-}

escape_xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

# No systemd o % e especificador (%h, %i, %%): todo valor literal da unit passa por aqui.
escape_unit() {
  printf '%s' "$1" | sed 's/%/%%/g'
}

# Aspas e barra invertida no caminho tornam a unit e o plist ambiguos: melhor recusar do que registrar
# um servico que aponta para outro lugar.
for candidate in "$project" "$entry" "$node_bin"; do
  case "$candidate" in
    *'"'* | *\\*)
      echo "caminho com aspas ou barra invertida nao e suportado pelo servico: $candidate" >&2
      exit 1
      ;;
  esac
done

plist_content() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(escape_xml "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(escape_xml "$node_bin")</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>$(escape_xml "$entry")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(escape_xml "$project")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(escape_xml "$service_path")</string>$([ -n "$service_lang" ] && printf '\n    <key>LANG</key>\n    <string>%s</string>' "$(escape_xml "$service_lang")")
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>60</integer>
  <key>ProcessType</key>
  <string>Standard</string>
  <key>StandardOutPath</key>
  <string>$(escape_xml "$project/data/service.log")</string>
  <key>StandardErrorPath</key>
  <string>$(escape_xml "$project/data/service.log")</string>
</dict>
</plist>
PLIST
}

unit_content() {
  unit_path=$(escape_unit "$service_path")
  unit_project=$(escape_unit "$project")
  unit_entry=$(escape_unit "$entry")
  unit_node=$(escape_unit "$node_bin")
  cat <<UNIT
[Unit]
Description=Syntax Routines: rotinas agendadas de Claude Code, Codex e scripts
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$unit_project
Environment="PATH=$unit_path"
ExecStart="$unit_node" --disable-warning=ExperimentalWarning "$unit_entry"
Restart=on-failure
RestartSec=60

[Install]
WantedBy=default.target
UNIT
}

if [ -n "$print_only" ]; then
  [ "$print_only" = "plist" ] && plist_content || unit_content
  exit 0
fi

if [ "$build" = "1" ]; then
  echo "==> npm ci e npm run build..."
  (cd "$project" && npm ci && npm run build)
fi
if [ ! -f "$entry" ]; then
  echo "Build nao encontrado em $entry. Rode o script com --build." >&2
  exit 1
fi
if [ ! -f "$project/.env" ]; then
  echo "==> Sem .env na raiz: configure o e-mail pelo painel, em Ajustes (ou copie .env.example para .env)."
fi
for cli in claude codex; do
  command -v "$cli" >/dev/null 2>&1 || echo "==> Aviso: $cli nao esta no PATH; rotinas desse agente vao falhar ate instalar e rodar este script de novo."
done

mkdir -p "$project/data"
. "$project/service/listener.sh"

wait_http() {
  attempt=0
  while [ "$attempt" -lt 40 ]; do
    if "$node_bin" -e 'fetch(process.argv[1]).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))' "$1" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
    attempt=$((attempt + 1))
  done
  return 1
}

stop_previous_listener() {
  listener=$(sr_stop_listener "$PORT" "$entry")
  case "$listener" in
    encerrado*) echo "==> Instancia anterior do Syntax Routines na porta $PORT encerrada (PID $(echo "$listener" | cut -d' ' -f2))." ;;
    outro*)
      echo "A porta $PORT esta ocupada por outro processo: $(echo "$listener" | cut -d' ' -f2-). Nada foi encerrado. Libere a porta e rode de novo." >&2
      exit 1
      ;;
  esac
}

install_macos() {
  plist="$HOME/Library/LaunchAgents/$LABEL.plist"
  uid=$(id -u)
  domain="gui/$uid"
  launchctl bootout "gui/$uid/$LABEL" 2>/dev/null || true
  launchctl bootout "user/$uid/$LABEL" 2>/dev/null || true
  stop_previous_listener

  mkdir -p "$HOME/Library/LaunchAgents"
  plist_content > "$plist"
  plutil -lint "$plist" >/dev/null

  attempt=0
  # Logo depois do bootout o dominio pode recusar por alguns instantes (erro 5, "Input/output error").
  until launchctl bootstrap "$domain" "$plist" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 5 ]; then
      if [ "$domain" = "gui/$uid" ]; then
        echo "==> Aviso: sem sessao grafica para o launchd (dominio gui); registrando no dominio user, que sobe no login por terminal."
        domain="user/$uid"
        attempt=0
        continue
      fi
      echo "launchctl bootstrap falhou no dominio $domain. Veja $project/data/service.log." >&2
      exit 1
    fi
    sleep 1
  done
  echo "==> LaunchAgent '$LABEL' registrado ($domain, sem sudo)."
  create_mac_shortcut
}

create_mac_shortcut() {
  app="$HOME/Applications/Syntax Routines.app"
  rm -rf "$app"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  cat > "$app/Contents/Info.plist" <<INFO
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Syntax Routines</string>
  <key>CFBundleIdentifier</key><string>$LABEL.shortcut</string>
  <key>CFBundleExecutable</key><string>syntax-routines</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
</dict>
</plist>
INFO
  # O atalho abre o painel em janela propria (modo app), sem barra de endereco. Sem navegador Chromium, abre no padrao.
  cat > "$app/Contents/MacOS/syntax-routines" <<LAUNCHER
#!/bin/sh
URL="$URL"
for browser in "Google Chrome" "Microsoft Edge" "Chromium" "Brave Browser"; do
  for base in /Applications "\$HOME/Applications"; do
    if [ -d "\$base/\$browser.app" ]; then
      exec open -na "\$base/\$browser.app" --args --app="\$URL" --window-size=1280,900
    fi
  done
done
exec open "\$URL"
LAUNCHER
  chmod +x "$app/Contents/MacOS/syntax-routines"

  icon_png="$project/public/brand/icon-512.png"
  if [ -f "$icon_png" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    iconset=$(mktemp -d "${TMPDIR:-/tmp}/sr-iconset-XXXXXX")/AppIcon.iconset
    mkdir -p "$iconset"
    for size in 16 32 128 256 512; do
      sips -z "$size" "$size" "$icon_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null 2>&1 || true
    done
    iconutil -c icns "$iconset" -o "$app/Contents/Resources/AppIcon.icns" 2>/dev/null || true
    rm -rf "$(dirname "$iconset")"
  fi
  echo "==> Atalho criado: $app"
}

install_linux() {
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "Sem sessao de usuario do systemd (systemctl --user nao responde). Neste caso suba o app na mao com ./start.sh, ou instale em uma sessao grafica." >&2
    exit 1
  fi
  unit_file="$HOME/.config/systemd/user/$UNIT"
  systemctl --user stop "$UNIT" 2>/dev/null || true
  stop_previous_listener

  mkdir -p "$HOME/.config/systemd/user"
  unit_content > "$unit_file"
  systemctl --user daemon-reload
  systemctl --user enable --now "$UNIT"
  echo "==> Unit '$UNIT' registrada e iniciada (systemctl --user, sem sudo)."
  create_linux_shortcut
}

create_linux_shortcut() {
  desktop="$HOME/.local/share/applications/syntax-routines.desktop"
  mkdir -p "$(dirname "$desktop")"
  exec_line="xdg-open $URL"
  for browser in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser; do
    if command -v "$browser" >/dev/null 2>&1; then
      exec_line="$browser --app=$URL --window-size=1280,900"
      break
    fi
  done
  cat > "$desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Syntax Routines
Comment=Painel das rotinas agendadas
Exec=$exec_line
Icon=$project/public/brand/icon-512.png
Terminal=false
Categories=Utility;Development;
DESKTOP
  echo "==> Atalho criado: $desktop"
}

case "$system" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
  *)
    echo "Sistema nao suportado por este script: $system. No Windows use service\\install.ps1." >&2
    exit 1
    ;;
esac

if ! wait_http "${URL}api/auth/state"; then
  echo "O app nao respondeu em $URL. Veja $project/data/app.log e $project/data/service.log." >&2
  exit 1
fi

echo ""
echo "Pronto. Painel em $URL (atalho 'Syntax Routines')."
echo "O app sobe sozinho a cada login de $(id -un). Log do app: $project/data/app.log"
