<#
.SYNOPSIS
  Teste de runtime do listener.ps1: processos reais escutando uma porta efemera. Nao precisa de administrador.

.DESCRIPTION
  So o node.exe que executa o entry DESTE projeto como script pode ser encerrado. Os casos cobrem as formas
  de um processo alheio carregar o caminho do entry sem estar rodando ele: como argumento de outro script,
  como argumento de codigo inline (`-e`, `--eval=`) e com flag do node que nao esta na lista fechada.

.EXAMPLE
  pwsh -File .\service\listener.test.ps1
#>

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "listener.ps1")

$node = (Get-Command node).Source
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("sr-listener-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$appEntry = Join-Path $tmp "syntax-routines\dist\server\index.mjs"
$otherEntry = Join-Path $tmp "outro-produto\dist\server\index.mjs"
$siblingEntry = Join-Path $tmp "syntax-routines-old\dist\server\index.mjs"
$preload = Join-Path $tmp "preload.cjs"
# Como script, a porta vem em argv[2]; como codigo inline, em argv[1]. Sem espacos para a linha de comando
# ficar igual a de um processo real com `--eval=<codigo>`.
$serverSource = "import http from 'node:http'; http.createServer((req,res)=>res.end('ok')).listen(Number(process.argv[2]),'127.0.0.1');"
$inlineSource = "require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.argv[1]),'127.0.0.1')"
foreach ($file in @($appEntry, $otherEntry, $siblingEntry)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $file -Parent) | Out-Null
  Set-Content -Path $file -Value $serverSource -Encoding UTF8
}
Set-Content -Path $preload -Value "// preload vazio" -Encoding UTF8

$failures = 0
function Assert-That([bool]$Condition, [string]$Message) {
  if ($Condition) {
    Write-Host "ok  $Message"
  } else {
    Write-Host "FALHOU  $Message"
    $script:failures++
  }
}

function Get-FreePort {
  $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $probe.Start()
  $freePort = $probe.LocalEndpoint.Port
  $probe.Stop()
  return $freePort
}

function Wait-PortState([int]$Port, [bool]$Listening) {
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    $isListening = [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if ($isListening -eq $Listening) { return }
    Start-Sleep -Milliseconds 150
  }
  throw "A porta $Port nao chegou ao estado esperado (escutando=$Listening)."
}

function Start-NodeProcess([string[]]$Arguments, [int]$Port) {
  $process = Start-Process -FilePath $node -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  Wait-PortState $Port $true
  return $process
}

function Test-IsAlive([int]$ProcessId) {
  return [bool](Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

$port = Get-FreePort
$started = @()

function Test-Alheio([string]$Titulo, [string[]]$Arguments) {
  $process = Start-NodeProcess $Arguments $port
  $script:started += $process
  Assert-That ((Stop-RoutinesListener -Port $port -Entry $appEntry).Status -eq "outro") "$Titulo : status outro"
  Assert-That (Test-IsAlive $process.Id) "$Titulo : processo continua vivo"
  Stop-Process -Id $process.Id -Force
  Wait-PortState $port $false
}

function Test-Proprio([string]$Titulo, [string[]]$Arguments) {
  $process = Start-NodeProcess $Arguments $port
  $script:started += $process
  Assert-That ((Stop-RoutinesListener -Port $port -Entry $appEntry).Status -eq "encerrado") "$Titulo : status encerrado"
  Wait-PortState $port $false
  Assert-That (-not (Test-IsAlive $process.Id)) "$Titulo : processo encerrado"
}

try {
  Test-Alheio "node de outro produto" @("`"$otherEntry`"", $port)
  Test-Alheio "pasta irma com o mesmo prefixo" @("`"$siblingEntry`"", $port)
  Test-Alheio "entry como argumento de outro script" @("`"$otherEntry`"", $port, "`"$appEntry`"")
  Test-Alheio "codigo inline com -e e o entry como argumento" @("-e", $inlineSource, $port, "`"$appEntry`"")
  Test-Alheio "codigo inline com --eval= e o entry como argumento" @("--eval=$inlineSource", $port, "`"$appEntry`"")
  Test-Alheio "flag fora da lista (--require=) antes do entry" @("--require=$preload", "`"$appEntry`"", $port)

  Test-Proprio "o proprio Syntax Routines" @("`"$appEntry`"", $port)
  Test-Proprio "o proprio app com a flag do lancador" @("--disable-warning=ExperimentalWarning", "`"$appEntry`"", $port)

  # O start.cmd chama "node.exe" pelo PATH, e nao o caminho completo do executavel.
  $viaPath = Start-Process -FilePath "node.exe" -ArgumentList @("--disable-warning=ExperimentalWarning", "`"$appEntry`"", $port) -WindowStyle Hidden -PassThru
  $started += $viaPath
  Wait-PortState $port $true
  Assert-That ((Stop-RoutinesListener -Port $port -Entry $appEntry).Status -eq "encerrado") "app iniciado como node.exe pelo PATH : status encerrado"
  Wait-PortState $port $false
  Assert-That (-not (Test-IsAlive $viaPath.Id)) "app iniciado como node.exe pelo PATH : processo encerrado"

  $python = Start-Process -FilePath python -ArgumentList @("-m", "http.server", $port, "--bind", "127.0.0.1") -WindowStyle Hidden -PassThru
  $started += $python
  Wait-PortState $port $true
  Assert-That ((Stop-RoutinesListener -Port $port -Entry $appEntry).Status -eq "outro") "processo que nao e node : status outro"
  Assert-That (Test-IsAlive $python.Id) "processo que nao e node : processo continua vivo"
  Stop-Process -Id $python.Id -Force
  Wait-PortState $port $false

  Assert-That ((Stop-RoutinesListener -Port $port -Entry $appEntry).Status -eq "livre") "porta livre : status livre"
} finally {
  foreach ($process in $started) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

if ($failures -gt 0) {
  Write-Host "listener.test: $failures falha(s)"
  exit 1
}
Write-Host "listener.test: verde"
