$ErrorActionPreference = 'Stop'
$strokeRoot = $PSScriptRoot
$strokeElectron = Join-Path $strokeRoot 'desktop/node_modules/electron/dist/electron.exe'
if (!(Test-Path -LiteralPath $strokeElectron)) {
    throw 'Electron is missing in this checkout. Run: cd desktop; pnpm install --frozen-lockfile; node node_modules/electron/install.js; cd .. . See DESKTOP.md.'
}
if (!(Test-Path -LiteralPath (Join-Path $strokeRoot 'app/desktop-dist/index.html'))) {
    throw 'The desktop UI is missing in this checkout. Run: cd app; pnpm exec vite build --config vite.desktop.config.ts; cd ..'
}
if (!(Test-Path -LiteralPath (Join-Path $strokeRoot '.venv/Scripts/python.exe')) -or !(Test-Path -LiteralPath (Join-Path $strokeRoot 'models/pose_landmarker_full.task'))) {
    throw 'The Python environment or pose model is missing in this checkout. Run .\Setup-Stroke.ps1 first.'
}
Start-Process -FilePath $strokeElectron -ArgumentList ('"' + (Join-Path $strokeRoot 'desktop') + '"') -WorkingDirectory $strokeRoot -WindowStyle Hidden
