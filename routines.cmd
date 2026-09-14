@echo off
rem CLI do Syntax Routines para quem ja instalou o app: "routines.cmd list", "routines.cmd settings".
rem Chama o build em dist\routines.mjs e esconde o aviso de que node:sqlite e experimental.
setlocal
if not exist "%~dp0dist\routines.mjs" (
  echo Build nao encontrado. Rode "npm run build" na pasta do projeto ou reinstale com service\install.ps1 -Build.
  exit /b 1
)
node --disable-warning=ExperimentalWarning "%~dp0dist\routines.mjs" %*
