<#
.SYNOPSIS
  Remove a tarefa agendada e o atalho do Syntax Routines. Os dados em data\ (rotinas, historico, logs) ficam.
  Nao precisa de administrador: a tarefa pertence ao proprio usuario.

.EXAMPLE
  .\service\uninstall.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$TaskName = "SyntaxRoutines"
$Port = 4090

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tarefa '$TaskName' removida." -ForegroundColor Green
} else {
  Write-Host "Tarefa '$TaskName' nao existe." -ForegroundColor Yellow
}

# Parar a tarefa derruba o conhost; o node pode ficar orfao segurando a porta. So o do proprio app e encerrado.
. (Join-Path $PSScriptRoot "listener.ps1")
$Entry = Join-Path (Split-Path $PSScriptRoot -Parent) "dist\server\index.mjs"
$stop = Stop-RoutinesListener -Port $Port -Entry $Entry
if ($stop.Status -eq "encerrado") {
  Write-Host "Syntax Routines (PID $($stop.Listener.ProcessId)) na porta $Port encerrado." -ForegroundColor Green
} elseif ($stop.Status -eq "outro") {
  Write-Host "A porta $Port esta com outro processo ($($stop.Listener.Name), PID $($stop.Listener.ProcessId)); ele nao foi tocado." -ForegroundColor Yellow
}

$desktop = [Environment]::GetFolderPath("Desktop")
foreach ($shortcut in @((Join-Path $desktop "Syntax Routines.lnk"), (Join-Path $desktop "Syntax Routines.url"))) {
  if (Test-Path $shortcut) {
    Remove-Item $shortcut -Force
    Write-Host "Atalho removido: $shortcut" -ForegroundColor Green
  }
}

Write-Host "Dados preservados em $(Join-Path (Split-Path $PSScriptRoot -Parent) 'data')." -ForegroundColor DarkGray
