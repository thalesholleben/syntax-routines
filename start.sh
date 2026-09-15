#!/bin/sh
# Sobe o Syntax Routines na mao no macOS e no Linux (sem o servico de login). Precisa de npm run build antes.
# O entry vai por caminho absoluto e so com a flag abaixo: e assim que install.sh e uninstall.sh reconhecem o app.
set -eu
project=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cd "$project"
exec node --disable-warning=ExperimentalWarning "$project/dist/server/index.mjs"
