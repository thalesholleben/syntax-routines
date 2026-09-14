@echo off
rem Agente falso do smoke e2e: consome o prompt do stdin e responde como o stream-json do Claude Code.
more > nul
echo {"type":"result","result":"ok fake"}
