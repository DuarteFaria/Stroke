param([switch]$SkipAnalyzer, [switch]$Unpacked)
$ErrorActionPreference = 'Stop'
$strokeRoot = $PSScriptRoot
$strokeOriginalPath = $env:Path
function Invoke-StrokeBuild([scriptblock]$Action) {
    & $Action
    if ($LASTEXITCODE -ne 0) { throw "Build failed ($LASTEXITCODE)." }
}
Push-Location $strokeRoot
try {
    # A normal PowerShell window does not inherit Codex's bundled tool PATH.
    $strokeRuntime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
    $strokeToolPaths = @(
        (Join-Path $strokeRuntime 'node/bin'),
        (Join-Path $strokeRuntime 'bin/fallback')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Container }
    if ($strokeToolPaths.Count) { $env:Path = ($strokeToolPaths -join ';') + ';' + $env:Path }
    $strokeNode = Get-Command node -ErrorAction SilentlyContinue
    $strokePnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if (!$strokeNode -or !$strokePnpm) {
        throw 'Node.js and pnpm are required to build Stroke. Install Node 24 and pnpm 11, or run on a computer with the Codex bundled runtimes, then reopen PowerShell.'
    }
    if (!$SkipAnalyzer -and !(Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
        throw 'Python environment missing. Run Setup-Stroke.ps1 first.'
    }
    Write-Output "Node: $($strokeNode.Source)"
    Write-Output "pnpm: $($strokePnpm.Source)"
    if (!$SkipAnalyzer) {
        Invoke-StrokeBuild { & .venv/Scripts/python.exe -m pip install -r requirements-desktop.txt }
        Invoke-StrokeBuild { & .venv/Scripts/python.exe backend/setup_model.py }
        $strokeModelData = (Join-Path $strokeRoot 'models/pose_landmarker_full.task') + ';models'
        $strokeHeavyData = (Join-Path $strokeRoot 'models/pose_landmarker_heavy.task') + ';models'
        Invoke-StrokeBuild { & .venv/Scripts/python.exe -m PyInstaller --noconfirm --onedir --name stroke-analyzer --distpath build/analyzer --workpath build/pyinstaller --specpath build --paths . --collect-all mediapipe --collect-all uvicorn --add-data $strokeModelData --add-data $strokeHeavyData backend/desktop_entry.py }
    }
    Push-Location app
    try {
        Invoke-StrokeBuild { pnpm install --frozen-lockfile }
        Invoke-StrokeBuild { pnpm exec vite build --config vite.desktop.config.ts }
    } finally { Pop-Location }
    Push-Location desktop
    try {
        Invoke-StrokeBuild { pnpm install --frozen-lockfile }
        if (!(Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe')) {
            Invoke-StrokeBuild { node node_modules/electron/install.js }
        }
        if ($Unpacked) { Invoke-StrokeBuild { pnpm run pack } }
        else { Invoke-StrokeBuild { pnpm run dist } }
    } finally { Pop-Location }
} finally {
    $env:Path = $strokeOriginalPath
    Pop-Location
}
