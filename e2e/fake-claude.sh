#!/bin/sh
# Agente falso do smoke e2e no macOS e no Linux: consome o prompt do stdin e responde como o stream-json do Claude Code.
cat > /dev/null
echo '{"type":"result","result":"ok fake"}'
