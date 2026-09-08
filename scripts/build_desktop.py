"""Build on the target OS with this environment's Python and pnpm on PATH."""
import argparse
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def run(*args, cwd=ROOT):
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-analyzer', action='store_true')
    parser.add_argument('--unpacked', action='store_true')
    args = parser.parse_args()
    if sys.platform not in ('win32', 'darwin'):
        parser.error('Build on Windows x64 or an Apple Silicon Mac.')
    arch = 'arm64' if sys.platform == 'darwin' else 'x64'
    if platform.machine().lower() not in ({'arm64', 'aarch64'} if arch == 'arm64' else {'amd64', 'x86_64'}):
        parser.error('The Python architecture must match the target: Windows x64 or macOS arm64.')
    pnpm = shutil.which('pnpm')
    if not pnpm:
        parser.error('Install Node.js 24 and pnpm 11 first.')
    if not args.skip_analyzer:
        run(sys.executable, '-m', 'pip', 'install', '-r', 'requirements-desktop.txt')
        run(sys.executable, 'backend/setup_model.py')
        model_args = []
        for variant in ('full', 'heavy'):
            model_args.extend(['--add-data', f'{ROOT / "models" / f"pose_landmarker_{variant}.task"}{os.pathsep}models'])
        run(sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
            '--name', 'stroke-analyzer', '--distpath', 'build/analyzer',
            '--workpath', 'build/pyinstaller', '--specpath', 'build', '--paths', '.',
            '--collect-all', 'mediapipe', '--collect-all', 'uvicorn',
            *model_args, 'backend/desktop_entry.py')
    analyzer = ROOT / 'build/analyzer/stroke-analyzer' / ('stroke-analyzer.exe' if sys.platform == 'win32' else 'stroke-analyzer')
    if not analyzer.is_file():
        parser.error(f'Bundled analyzer missing: {analyzer}')
    run(pnpm, 'install', '--frozen-lockfile', cwd=ROOT / 'app')
    run(pnpm, 'exec', 'vite', 'build', '--config', 'vite.desktop.config.ts', cwd=ROOT / 'app')
    run(pnpm, 'install', '--frozen-lockfile', cwd=ROOT / 'desktop')
    run(pnpm, 'exec', 'electron-builder', '--mac' if sys.platform == 'darwin' else '--win',
        *(['--dir'] if args.unpacked else ['dmg' if sys.platform == 'darwin' else 'nsis']),
        f'--{arch}', '--publish', 'never', cwd=ROOT / 'desktop')


if __name__ == '__main__':
    main()
