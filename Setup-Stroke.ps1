$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$strokeRuntime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies'
$strokePython = Join-Path $strokeRuntime 'python/python.exe'
if (!(Test-Path -LiteralPath $strokePython)) { $strokePython = (Get-Command python -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath '.venv/Scripts/python.exe')) { & $strokePython -m venv .venv; if ($LASTEXITCODE) { throw 'Could not create Python environment.' } }
& '.venv/Scripts/python.exe' -m pip install -r requirements.txt
if ($LASTEXITCODE) { throw 'Python dependency installation failed.' }
& '.venv/Scripts/python.exe' backend/setup_model.py
if ($LASTEXITCODE) { throw 'Model download failed.' }
$env:Path = (Join-Path $strokeRuntime 'node/bin') + ';' + (Join-Path $strokeRuntime 'bin/fallback') + ';' + $env:Path
pnpm --dir app install --frozen-lockfile
if ($LASTEXITCODE) { throw 'Frontend dependency installation failed.' }
Write-Output 'Setup complete. Run Start-Stroke.ps1.'
