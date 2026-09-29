<#
.SYNOPSIS
  Teste da definicao da tarefa agendada que o install.ps1 registra. Nao registra nada e nao precisa de administrador.

.DESCRIPTION
  Usa o `-PrintTask`, do mesmo jeito que o install.test.sh usa o `--print-unit` e o `--print-plist` do install.sh.
  O caso que mais importa e a prioridade: o Agendador registra tarefa em prioridade 7 (segundo plano, com E/S
  estrangulada) e, com o antivirus conferindo cada leitura, carregar node_modules nessa faixa passa de minutos.
  O app subia em 4 s em prioridade 4 e nao respondia em 5 min na 7, sem escrever uma linha de log.
  O segundo caso e o caminho do projeto com espaco e com %, que precisa chegar citado na linha de comando.

.EXAMPLE
  pwsh -File .\service\install.test.ps1
#>

$ErrorActionPreference = "Stop"
$project = Split-Path $PSScriptRoot -Parent
$installer = Join-Path $PSScriptRoot "install.ps1"

$failures = 0
function Assert-That([bool]$Condition, [string]$Message) {
  if ($Condition) {
    Write-Host "ok  $Message"
  } else {
    Write-Host "FALHOU  $Message"
    $script:failures++
  }
}

function Get-TaskFields([string]$Script) {
  $fields = @{}
  foreach ($line in (& pwsh -NoProfile -File $Script -PrintTask)) {
    $pair = $line -split "=", 2
    if ($pair.Count -eq 2) { $fields[$pair[0]] = $pair[1] }
  }
  return $fields
}

$task = Get-TaskFields $installer

Assert-That ($task["priority"] -eq "4") "tarefa registrada em prioridade 4, nao na 7 do Agendador"
Assert-That ([int]$task["readydeadlineseconds"] -ge 45) "instalador espera pelo menos 45 s pela primeira resposta"
Assert-That ($task["multipleinstances"] -eq "IgnoreNew") "uma instancia por vez"
Assert-That ($task["executiontimelimit"] -eq "PT0S") "sem limite de tempo de execucao"
Assert-That ($task["restartcount"] -eq "999") "reinicia sozinha se cair"
Assert-That ($task["runlevel"] -eq "Limited") "roda sem elevacao"
Assert-That ($task["logontype"] -eq "Interactive") "roda no logon interativo do usuario"
Assert-That ($task["execute"] -like "*\conhost.exe") "executa pelo conhost, que e quem esconde a janela"
Assert-That ($task["arguments"] -like "--headless *") "conhost em modo headless"
Assert-That ($task["arguments"] -like "*dist\server\index.mjs`"") "entry do app citado no fim dos argumentos"
Assert-That ($task["workingdirectory"] -eq $project) "diretorio de trabalho e a raiz do projeto"

# Caminho com espaco e com % (o mesmo risco que o install.sh corre no systemd) precisa sair citado.
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("sr-install-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$fake = Join-Path $tmp "pasta com espaco e 100% de risco\syntax-routines"
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $fake "service"), (Join-Path $fake "dist\server") | Out-Null
  Copy-Item $installer, (Join-Path $PSScriptRoot "listener.ps1") -Destination (Join-Path $fake "service")
  Set-Content -Path (Join-Path $fake "dist\server\index.mjs") -Value "// entry de mentira" -Encoding UTF8
  $odd = Get-TaskFields (Join-Path $fake "service\install.ps1")
  $entry = Join-Path $fake "dist\server\index.mjs"
  Assert-That ($odd["arguments"] -like "*`"$entry`"") "entry com espaco e % sai citado nos argumentos"
  Assert-That ($odd["workingdirectory"] -eq $fake) "diretorio de trabalho com espaco e % preservado"
  Assert-That ($odd["priority"] -eq "4") "prioridade 4 tambem na copia"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
if ($failures -gt 0) {
  Write-Host "$failures caso(s) falharam." -ForegroundColor Red
  exit 1
}
Write-Host "definicao da tarefa do install.ps1 verde." -ForegroundColor Green
