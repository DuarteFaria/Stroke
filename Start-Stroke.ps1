param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$strokeRoot = $PSScriptRoot
$strokePython = Join-Path $strokeRoot '.venv/Scripts/python.exe'
$strokeNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (!(Test-Path -LiteralPath $strokeNode)) { $strokeNode = (Get-Command node -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath $strokePython)) { throw 'Run Setup-Stroke.ps1 first.' }
$strokeLogs = Join-Path $strokeRoot '.local'
New-Item -ItemType Directory -Force -Path $strokeLogs | Out-Null
function Test-StrokeUrl([string]$Address) {
    try { return (Invoke-WebRequest -Uri $Address -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}
$strokeProcessIds = @()
$strokePidFile = Join-Path $strokeLogs 'processes.json'
if (Test-Path -LiteralPath $strokePidFile) { $strokeProcessIds = @(Get-Content -LiteralPath $strokePidFile -Raw | ConvertFrom-Json) }
if (!(Test-StrokeUrl 'http://127.0.0.1:8766/health')) {
    $strokeBackend = Start-Process -FilePath $strokePython -ArgumentList '-m uvicorn backend.main:app --host 127.0.0.1 --port 8766' -WorkingDirectory $strokeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $strokeLogs 'backend.log') -RedirectStandardError (Join-Path $strokeLogs 'backend-error.log')
    $strokeProcessIds += $strokeBackend.Id
}
if (!(Test-StrokeUrl 'http://127.0.0.1:3000/')) {
    $strokeCli = Join-Path $strokeRoot 'app/node_modules/vinext/dist/cli.js'
    $strokeFrontend = Start-Process -FilePath $strokeNode -ArgumentList ('"' + $strokeCli + '" dev') -WorkingDirectory (Join-Path $strokeRoot 'app') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $strokeLogs 'frontend.log') -RedirectStandardError (Join-Path $strokeLogs 'frontend-error.log')
    $strokeProcessIds += $strokeFrontend.Id
}
ConvertTo-Json -InputObject @($strokeProcessIds | Select-Object -Unique) | Set-Content -LiteralPath $strokePidFile
$strokeReady = $false
for ($strokeAttempt = 0; $strokeAttempt -lt 30; $strokeAttempt++) {
    if ((Test-StrokeUrl 'http://127.0.0.1:3000/') -and (Test-StrokeUrl 'http://127.0.0.1:8766/health')) { $strokeReady = $true; break }
    Start-Sleep -Milliseconds 500
}
if (!$strokeReady) { throw 'Stroke did not start. Check the .local log files in this folder.' }
Write-Output 'Stroke is ready at http://127.0.0.1:3000/'
if (!$NoBrowser) { Start-Process 'http://127.0.0.1:3000/' }
