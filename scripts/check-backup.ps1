<#
.SYNOPSIS
  Confere o registro da ultima execucao de um backup (arquivo latest.json) e sai com 1 quando ele nao esta em dia.

.DESCRIPTION
  Feito para rodar como rotina de script do Syntax Routines: o codigo de saida diferente de 0 vira "Falhou" no painel
  e dispara o aviso por e-mail. Le um JSON com os campos `status` (success | failed | running), `started_at`
  (data ISO 8601) e `error`, como o gravado por um script de backup diario.

  Falha quando: o arquivo nao existe ou nao e JSON; `status` e `failed` (mostra `error`); `status` e `success` mas
  `started_at` tem mais de -MaxAgeHours; `status` e `running` ha mais de -RunningMaxHours; ou nao da para ler `started_at`.

.PARAMETER LatestJson
  Caminho do latest.json gravado pelo backup.

.PARAMETER MaxAgeHours
  Idade maxima de um backup com sucesso (padrao 30 h: backup diario com folga para o PC ligar tarde).

.PARAMETER RunningMaxHours
  Quanto tempo um `running` pode durar antes de ser tratado como travado (padrao 3 h).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-backup.ps1 -LatestJson D:\Backups\logs\latest.json
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$LatestJson,
  [int]$MaxAgeHours = 30,
  [int]$RunningMaxHours = 3
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Host "BACKUP COM PROBLEMA: $Message"
  exit 1
}

if (-not (Test-Path -LiteralPath $LatestJson -PathType Leaf)) { Fail "arquivo nao encontrado: $LatestJson" }

try {
  $latest = Get-Content -LiteralPath $LatestJson -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  Fail "nao consegui ler o JSON em ${LatestJson}: $($_.Exception.Message)"
}

$status = [string]$latest.status
$startedRaw = [string]$latest.started_at
try {
  $startedAt = [DateTimeOffset]::Parse($startedRaw, [System.Globalization.CultureInfo]::InvariantCulture)
} catch {
  Fail "started_at ilegivel ('$startedRaw') com status '$status'"
}
$ageHours = [math]::Round(([DateTimeOffset]::Now - $startedAt).TotalHours, 1)

switch ($status) {
  "success" {
    if ($ageHours -gt $MaxAgeHours) { Fail "ultimo backup com sucesso comecou ha $ageHours h (limite $MaxAgeHours h): $startedRaw" }
    Write-Host "Backup em dia: sucesso ha $ageHours h ($startedRaw)."
    exit 0
  }
  "running" {
    if ($ageHours -gt $RunningMaxHours) { Fail "backup marcado como 'running' ha $ageHours h; provavelmente travou ($startedRaw)" }
    Write-Host "Backup em andamento ha $ageHours h ($startedRaw)."
    exit 0
  }
  "failed" {
    $detail = if ($latest.error) { [string]$latest.error } else { "sem detalhe registrado" }
    Fail "ultima execucao falhou ($startedRaw): $detail"
  }
  default { Fail "status desconhecido '$status' em $LatestJson" }
}
