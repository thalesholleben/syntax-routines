#!/bin/sh
# CLI do Syntax Routines no macOS e no Linux para quem ja instalou o app: "./routines.sh list", "./routines.sh settings".
# Chama o build em dist/routines.mjs e esconde o aviso de que node:sqlite e experimental.
set -eu
project=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if [ ! -f "$project/dist/routines.mjs" ]; then
  echo "Build nao encontrado. Rode \"npm run build\" na pasta do projeto ou reinstale com service/install.sh --build." >&2
  exit 1
fi
exec node --disable-warning=ExperimentalWarning "$project/dist/routines.mjs" "$@"
