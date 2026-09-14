# Quem escuta na porta do Syntax Routines, e se e o proprio app. Usado por install.ps1 e uninstall.ps1.
# So pode ser encerrado o node.exe que esta EXECUTANDO o dist\server\index.mjs DESTE projeto como script.
# Qualquer outro processo fica intocado e conta como porta ocupada.

# Lista fechada das flags aceitas antes do entry: so a que os lancadores deste projeto usam (start.cmd,
# npm start e a tarefa agendada). Opcao arbitraria do node nao entra, porque ela pode executar codigo
# (`--eval=`, `-e`, `-p`) ou consumir o argumento seguinte (`--require`, `--import`), e nesse caso o entry
# seria um argumento inerte de outro programa, nao o script em execucao. Mudou a flag do lancador? Acrescente
# aqui e cubra no listener.test.ps1.
$script:AllowedNodeFlagPattern = '(?:\s+--disable-warning=[^\s"]+)*'

function Get-PortListener {
  param([Parameter(Mandatory)][int]$Port)
  $connection = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $connection) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
  return [pscustomobject]@{
    ProcessId   = [int]$connection.OwningProcess
    Name        = [string]$process.Name
    CommandLine = [string]$process.CommandLine
  }
}

function Test-IsRoutinesServer {
  param([string]$Name, [string]$CommandLine, [Parameter(Mandatory)][string]$Entry)
  if ($Name -ne "node.exe") { return $false }
  if (-not $CommandLine) { return $false }
  $normalizedCommand = $CommandLine.Replace("/", "\").ToLowerInvariant().Trim()
  $normalizedEntry = [regex]::Escape([System.IO.Path]::GetFullPath($Entry).Replace("/", "\").ToLowerInvariant())
  $executable = '(?:"[^"]*node\.exe"|[^\s"]*node\.exe)'
  $pattern = '^' + $executable + $script:AllowedNodeFlagPattern + '\s+"?' + $normalizedEntry + '"?(?:\s|$)'
  return [regex]::IsMatch($normalizedCommand, $pattern)
}

function Stop-RoutinesListener {
  param([Parameter(Mandatory)][int]$Port, [Parameter(Mandatory)][string]$Entry)
  $listener = Get-PortListener -Port $Port
  if (-not $listener) { return [pscustomobject]@{ Status = "livre"; Listener = $null } }
  if (Test-IsRoutinesServer -Name $listener.Name -CommandLine $listener.CommandLine -Entry $Entry) {
    Stop-Process -Id $listener.ProcessId -Force
    return [pscustomobject]@{ Status = "encerrado"; Listener = $listener }
  }
  return [pscustomobject]@{ Status = "outro"; Listener = $listener }
}
