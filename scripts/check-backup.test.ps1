<#
.SYNOPSIS
  Teste do check-backup.ps1 com arquivos latest.json de mentira: cada caso confere o codigo de saida e a mensagem.

.EXAMPLE
  pwsh -File .\scripts\check-backup.test.ps1
#>

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "check-backup.ps1"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("sr-backup-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$failures = 0
function Assert-That([bool]$Condition, [string]$Message) {
  if ($Condition) {
    Write-Host "ok  $Message"
  } else {
    Write-Host "FALHOU  $Message"
    $script:failures++
  }
}

function Invoke-Check([string]$Name, [hashtable]$Record, [string[]]$ExtraArgs = @()) {
  $file = Join-Path $tmp "$Name.json"
  if ($null -ne $Record) { ($Record | ConvertTo-Json) | Set-Content -Path $file -Encoding UTF8 }
  # powershell.exe (5.1), o mesmo interpretador das rotinas importadas.
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -LatestJson $file @ExtraArgs 2>&1 | Out-String
  return @{ Code = $LASTEXITCODE; Output = $output.Trim() }
}

function Iso([double]$HoursAgo) {
  return [DateTimeOffset]::Now.AddHours(-$HoursAgo).ToString("yyyy-MM-ddTHH:mm:ss.fffffffzzz")
}

try {
  $r = Invoke-Check "ausente" $null
  Assert-That ($r.Code -eq 1 -and $r.Output -match "nao encontrado") "arquivo ausente falha"

  Set-Content -Path (Join-Path $tmp "quebrado.json") -Value "{ isto nao e json" -Encoding UTF8
  $r = Invoke-Check "quebrado" $null
  Assert-That ($r.Code -eq 1 -and $r.Output -match "JSON") "JSON quebrado falha"

  $r = Invoke-Check "sucesso-recente" @{ status = "success"; started_at = (Iso 15) }
  Assert-That ($r.Code -eq 0 -and $r.Output -match "em dia") "sucesso ha 15 h passa"

  $r = Invoke-Check "sucesso-velho" @{ status = "success"; started_at = (Iso 31) }
  Assert-That ($r.Code -eq 1 -and $r.Output -match "limite 30 h") "sucesso ha 31 h falha"

  $r = Invoke-Check "sucesso-limite-maior" @{ status = "success"; started_at = (Iso 31) } @("-MaxAgeHours", "40")
  Assert-That ($r.Code -eq 0) "sucesso ha 31 h passa com -MaxAgeHours 40"

  $r = Invoke-Check "falhou" @{ status = "failed"; started_at = (Iso 2); error = "Robocopy falhou com codigo 11" }
  Assert-That ($r.Code -eq 1 -and $r.Output -match "Robocopy falhou com codigo 11") "failed falha e mostra o erro"

  $r = Invoke-Check "rodando-recente" @{ status = "running"; started_at = (Iso 1) }
  Assert-That ($r.Code -eq 0 -and $r.Output -match "em andamento") "running ha 1 h passa"

  $r = Invoke-Check "rodando-travado" @{ status = "running"; started_at = (Iso 4) }
  Assert-That ($r.Code -eq 1 -and $r.Output -match "travou") "running ha 4 h falha"

  $r = Invoke-Check "data-ilegivel" @{ status = "success"; started_at = "ontem" }
  Assert-That ($r.Code -eq 1 -and $r.Output -match "ilegivel") "started_at ilegivel falha"

  $r = Invoke-Check "status-estranho" @{ status = "maybe"; started_at = (Iso 1) }
  Assert-That ($r.Code -eq 1 -and $r.Output -match "desconhecido") "status desconhecido falha"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

if ($failures -gt 0) {
  Write-Host "check-backup.test: $failures falha(s)"
  exit 1
}
Write-Host "check-backup.test: verde"
