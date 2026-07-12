$ProjectRoot = "C:\Users\neo-jagur\Documents\Codex\2026-07-07\i-want-to-build-the-nixp"
$BundledNode = "C:\Users\neo-jagur\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$Port = 4173
$LogDir = Join-Path $ProjectRoot "work"
$LogFile = Join-Path $LogDir "nixp-local-server.log"
$ErrorLogFile = Join-Path $LogDir "nixp-local-server-error.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($Listener) {
  "[$(Get-Date -Format s)] NIXP local server already running on port $Port." | Add-Content $LogFile
  exit 0
}

$Node = if (Test-Path $BundledNode) { $BundledNode } else { "node" }
$Arguments = "scripts\dev-server.mjs"

"[$(Get-Date -Format s)] Starting NIXP local server on http://localhost:$Port" | Add-Content $LogFile
Start-Process -FilePath $Node -ArgumentList $Arguments -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError $ErrorLogFile
