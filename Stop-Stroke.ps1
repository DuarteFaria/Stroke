$ErrorActionPreference = 'Stop'
$strokeRoot = $PSScriptRoot
$strokePidFile = Join-Path $strokeRoot '.local/processes.json'
if (!(Test-Path -LiteralPath $strokePidFile)) { Write-Output 'No launcher-owned processes to stop.'; return }
$strokeIds = @(Get-Content -LiteralPath $strokePidFile -Raw | ConvertFrom-Json)
foreach ($strokeId in $strokeIds) {
    $strokeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $strokeId" -ErrorAction SilentlyContinue
    if (!$strokeProcess) { continue }
    $strokeIsFrontend = $strokeProcess.CommandLine -like ('*' + (Join-Path $strokeRoot 'app/node_modules/vinext/dist/cli.js') + '*')
    $strokeIsBackend = $strokeProcess.ExecutablePath -eq (Join-Path $strokeRoot '.venv/Scripts/python.exe').Replace('/','\') -and $strokeProcess.CommandLine -like '*uvicorn backend.main:app*'
    if ($strokeIsBackend) {
        # Windows venv Python starts a base-runtime child. Verify its parent and
        # exact service command before stopping it, then stop the venv launcher.
        Get-CimInstance Win32_Process -Filter "ParentProcessId = $strokeId" |
            Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*uvicorn backend.main:app --host 127.0.0.1 --port 8766*' } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    }
    if ($strokeIsFrontend -or $strokeIsBackend) { Stop-Process -Id $strokeId -ErrorAction SilentlyContinue }
}
Remove-Item -LiteralPath $strokePidFile
Write-Output 'Stopped launcher-owned Stroke services.'
