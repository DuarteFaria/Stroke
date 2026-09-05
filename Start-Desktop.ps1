$ErrorActionPreference = 'Stop'
$strokeRoot = $PSScriptRoot
$strokeElectron = Join-Path $strokeRoot 'desktop/node_modules/electron/dist/electron.exe'
if (!(Test-Path -LiteralPath $strokeElectron) -or !(Test-Path -LiteralPath (Join-Path $strokeRoot 'app/desktop-dist/index.html'))) {
    throw 'Build the desktop UI and install desktop dependencies first. See DESKTOP.md.'
}
Start-Process -FilePath $strokeElectron -ArgumentList ('"' + (Join-Path $strokeRoot 'desktop') + '"') -WorkingDirectory $strokeRoot -WindowStyle Hidden
