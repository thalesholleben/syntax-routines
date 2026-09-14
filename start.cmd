@echo off
rem Sobe o Syntax Routines na mao (sem a tarefa agendada). Precisa de npm run build antes.
rem node.exe e caminho absoluto do entry: e assim que install.ps1 e uninstall.ps1 reconhecem o processo do app.
cd /d "%~dp0"
node.exe --disable-warning=ExperimentalWarning "%~dp0dist\server\index.mjs"
