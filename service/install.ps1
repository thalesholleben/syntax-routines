<#
.SYNOPSIS
  Instala o Syntax Routines para subir sozinho no logon do Windows, sem janela, com atalho na area de trabalho.

.DESCRIPTION
  Registra a tarefa agendada "SyntaxRoutines":
    - dispara no logon do usuario atual (Claude e Codex precisam do perfil dele: ~/.claude e ~/.codex);
    - roda com o proprio usuario, SEM elevacao: nada no app precisa de admin, e agente com acesso total nao deve
      ganhar admin de brinde. Por isso este script tambem nao precisa de PowerShell como Administrador;
    - sem limite de tempo, reinicia a cada 1 min se cair, uma instancia por vez;
    - executa "conhost.exe --headless node dist\server\index.mjs" para nao abrir janela de console.
  Cria "Syntax Routines.url" na area de trabalho apontando para http://127.0.0.1:4090/.

.PARAMETER Build
  Roda npm install e npm run build antes de registrar a tarefa.

.EXAMPLE
  .\service\install.ps1 -Build
#>

[CmdletBinding()]
param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$TaskName = "SyntaxRoutines"
$Port = 4090
$ProjectDir = Split-Path $PSScriptRoot -Parent
$Entry = Join-Path $ProjectDir "dist\server\index.mjs"
$User = "$env:USERDOMAIN\$env:USERNAME"
$Url = "http://127.0.0.1:$Port/"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "node.exe nao encontrado no PATH. Instale o Node.js 24.13 ou mais novo." }
$node = $nodeCommand.Source

if ($Build) {
  Write-Host "==> npm install e npm run build..." -ForegroundColor Cyan
  Push-Location $ProjectDir
  try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install falhou." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou." }
  } finally {
    Pop-Location
  }
}
if (-not (Test-Path $Entry)) { throw "Build nao encontrado em $Entry. Rode o script com -Build." }
if (-not (Test-Path (Join-Path $ProjectDir ".env"))) {
  Write-Host "==> Sem .env na raiz: o app sobe sem aviso por e-mail. Copie .env.example para .env e preencha o SMTP." -ForegroundColor Yellow
}

# Para a instalacao anterior. Parar a tarefa derruba o conhost, mas o node pode ficar orfao segurando a porta.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host "==> Removendo a tarefa anterior..." -ForegroundColor Yellow
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
. (Join-Path $PSScriptRoot "listener.ps1")
$stop = Stop-RoutinesListener -Port $Port -Entry $Entry
if ($stop.Status -eq "encerrado") {
  Write-Host "==> Instancia anterior do Syntax Routines na porta $Port encerrada (PID $($stop.Listener.ProcessId))." -ForegroundColor Yellow
} elseif ($stop.Status -eq "outro") {
  throw "A porta $Port esta ocupada por outro processo: $($stop.Listener.Name) (PID $($stop.Listener.ProcessId)) $($stop.Listener.CommandLine). Nada foi encerrado. Libere a porta e rode de novo."
}

$conhost = Join-Path $env:WINDIR "System32\conhost.exe"
$arguments = "--headless `"$node`" --disable-warning=ExperimentalWarning `"$Entry`""
$action = New-ScheduledTaskAction -Execute $conhost -Argument $arguments -WorkingDirectory $ProjectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1)
# RunLevel padrao (Limited): token normal do usuario, sem elevacao.
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Syntax Routines: executa rotinas agendadas de Claude Code e Codex." `
  -ErrorAction Stop | Out-Null
Write-Host "==> Tarefa '$TaskName' registrada (logon de $User, sem elevacao)." -ForegroundColor Green

# Atalho em modo app: o Chrome (ou o Edge) abre a URL numa janela propria, sem barra de endereco nem abas,
# com o icone do app na barra de tarefas. Sem nenhum dos dois, cai no atalho .url comum.
$desktop = [Environment]::GetFolderPath("Desktop")
$legacyShortcut = Join-Path $desktop "Syntax Routines.url"
if (Test-Path $legacyShortcut) { Remove-Item $legacyShortcut -Force }
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($browser) {
  $shortcut = Join-Path $desktop "Syntax Routines.lnk"
  $icon = Join-Path $ProjectDir "public\brand\syntax-x.ico"
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  $link.TargetPath = $browser
  $link.Arguments = "--app=$Url --window-size=1280,900"
  $link.WorkingDirectory = $ProjectDir
  $link.Description = "Syntax Routines"
  if (Test-Path $icon) { $link.IconLocation = "$icon,0" }
  $link.Save()
  Write-Host "==> Atalho em modo app criado: $shortcut (via $(Split-Path $browser -Leaf))" -ForegroundColor Green
} else {
  Set-Content -Path $legacyShortcut -Value "[InternetShortcut]`r`nURL=$Url`r`n" -Encoding ASCII
  Write-Host "==> Chrome e Edge nao encontrados; atalho comum criado: $legacyShortcut" -ForegroundColor Yellow
}

Start-ScheduledTask -TaskName $TaskName
$deadline = (Get-Date).AddSeconds(20)
$isUp = $false
while ((Get-Date) -lt $deadline) {
  try {
    $response = Invoke-WebRequest -Uri "${Url}api/auth/state" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -eq 200) { $isUp = $true; break }
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $isUp) { throw "O app nao respondeu em $Url. Veja $(Join-Path $ProjectDir 'data\app.log')." }

Write-Host ""
Write-Host "Pronto. Painel em $Url (atalho 'Syntax Routines' na area de trabalho)." -ForegroundColor Green
Write-Host "O app sobe sozinho a cada logon de $User. Log do app: $(Join-Path $ProjectDir 'data\app.log')" -ForegroundColor DarkGray
