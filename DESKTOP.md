# Stroke for Windows

The desktop edition runs entirely on the local computer. It bundles the editor, Python analyzer, native libraries and pose model. No account, upload to the cloud, Python installation or Node installation is required for testers.

## Running a release

Run `release/Stroke-0.2.0-Windows-x64-Setup.exe`, install for your Windows user, then open **Stroke** from the desktop or Start menu. The unpacked edition is `release/win-unpacked/Stroke.exe`; keep its entire folder together.

Open a video, select up to 120 seconds and choose **Detetar o atleta**. The 1 GB video limit still applies. Use **Guardar** or Ctrl+S to save a portable `.stroke.json` project. Videos remain separate files.

The app remembers the video location for projects on this computer. If the video moves, use **Escolher o original** to reconnect it. Name, size, dimensions and duration are checked; this is not a cryptographic content check.

Recovery snapshots are written after editor state changes. If the previous session has unsaved edits, the next launch offers recovery. These snapshots are not a project archive or a substitute for saving. Closing with unsaved changes offers a return to the editor or closing with recovery retained. A second launch focuses the existing window.

The **Stroke** menu shows the version. **Ajuda → Exportar diagnóstico…** exports the application/analyzer log. Local recovery, video-location records, temporary analysis files and logs live in Electron's per-user application data folder (`%APPDATA%/stroke-desktop` by default). Ordinary job completion/cancellation removes temporary videos; the next launch removes leftovers from interrupted jobs.

## Development

Run the existing `Setup-Stroke.ps1` on a fresh development computer first. Then:

```powershell
cd app
pnpm exec vite build --config vite.desktop.config.ts
cd ../desktop
pnpm install --frozen-lockfile
node node_modules/electron/install.js
cd ..
./Start-Desktop.ps1
```

This developer launch uses `.venv`; release builds use the bundled executable. The existing browser launcher still works independently.

## Build the installer

```powershell
./Build-Desktop.ps1
```

`-Unpacked` produces the standalone application folder. `-SkipAnalyzer` reuses an already-built analyzer when only the desktop UI or shell changed. Release artifacts go to `release/`. The build checks command exit codes, uses frozen frontend/desktop lockfiles, and pins Python packaging dependencies in `requirements-desktop.txt`.

`Build-Desktop.ps1` finds Codex's bundled Node/pnpm tools automatically, with installed tools on PATH as a fallback, and restores PATH afterward. Run it in an ordinary PowerShell window; administrator privileges are not needed.

The desktop frontend is a static Vite build of the same Studio component. It does not need Vinext's server at runtime. Electron serves these bundled assets on a random loopback port and launches the Python sidecar on another random loopback port. A fresh session token protects analyzer requests and selected-video reads. The renderer is sandboxed with context isolation and no Node integration; its preload bridge exposes only project, video and recovery operations. External navigation and new windows are blocked.

## Verification

Run the usual frontend and backend checks from README.md. To exercise a release with the supplied sample project and its matching video:

```powershell
$env:STROKE_SMOKE_PROJECT = (Resolve-Path examples/first-stroke.stroke.json).Path
$env:STROKE_SMOKE_VIDEO = "$env:USERPROFILE/Downloads/videoplayback.mp4"
Start-Process -FilePath release/win-unpacked/Stroke.exe -ArgumentList '--smoke-test' -WindowStyle Hidden -Wait
Get-Content "$env:TEMP/stroke-desktop-smoke/smoke-result.json"
```

This uses separate test application data and a copy of the project. It checks the actual renderer, authenticated API, video decoding, real inference, native file handlers, save cancellation, video reconnection and recovery. Dialog selections are automated, so it does not replace human checks of the operating system dialogs. Without fixture variables it runs startup/security checks only. Results and a screenshot are saved in that test directory.

## Before distributing widely

- Test installation, uninstall/reinstall and first launch on a clean Windows x64 computer without development runtimes.
- Test real footage and tracking speed on a slower tester's computer. Current Windows-host checks do not establish a minimum hardware specification.
- Test interrupted analysis, recovery and video relocation with testers.
- The initial installer is unsigned unless signing credentials are configured externally. Signing and automatic updates are not implemented as part of this beta; distribute new versioned installers manually.
- macOS/Linux packages and cloud features are deferred.
