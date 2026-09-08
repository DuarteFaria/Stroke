"""Publish the two tested installers together; reruns resume an unpublished draft."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def publish(directory, env, *, dry_run=False, run=subprocess.run):
    ref = env['GITHUB_REF']
    if env['GITHUB_EVENT_NAME'] not in ('push', 'workflow_dispatch'):
        raise ValueError('Only trusted push/manual runs may publish releases.')
    if ref != 'refs/heads/main' and not ref.startswith('refs/tags/v'):
        raise ValueError('Publish only from main or a version tag.')
    version = json.loads((ROOT / 'desktop/package.json').read_text(encoding='utf-8'))['version']
    tag = ref.removeprefix('refs/tags/') if ref.startswith('refs/tags/') else f"desktop-build-{env['GITHUB_RUN_NUMBER']}"
    if ref.startswith('refs/tags/') and tag != f'v{version}':
        raise ValueError('The version tag must match desktop/package.json.')
    files = [directory / f'Stroke-{version}-Windows-x64-Setup.exe',
             directory / f'Stroke-{version}-macOS-arm64.dmg']
    for file in files:
        if not file.is_file() or file.stat().st_size == 0:
            raise ValueError(f'Missing or empty installer: {file}')
    if dry_run:
        print(json.dumps({'tag': tag, 'commit': env['GITHUB_SHA'], 'files': [str(f) for f in files]}))
        return

    def gh(*args, check=True):
        return run(['gh', *args], check=check, text=True, capture_output=True)

    # Do not let a rerun of an old main commit replace a newer latest release.
    if ref == 'refs/heads/main':
        head = gh('api', f"repos/{env['GITHUB_REPOSITORY']}/git/ref/heads/main", '--jq', '.object.sha').stdout.strip()
        if head != env['GITHUB_SHA']:
            print('A newer main commit exists; skipping this superseded release.')
            return
    existing = gh('release', 'view', tag, '--json', 'isDraft', check=False)
    if existing.returncode == 0 and not json.loads(existing.stdout)['isDraft']:
        print(f'{tag} is already published; leaving it unchanged.')
        return
    notes = (f"Desktop beta {version}, built from `{env['GITHUB_SHA']}`.\n\n"
             "- Windows: download the x64 Setup.exe and run it.\n"
             "- Mac: M1 or newer, macOS 14+. Open the DMG and drag Stroke to Applications.\n"
             "- No Apple Developer ID signing or notarization. macOS may require Privacy & Security > Open Anyway.\n"
             "- Python and both pose models are bundled; no separate runtime installation is needed.\n\n"
             f"Both installers passed automated packaged-app and inference checks: "
             f"https://github.com/{env['GITHUB_REPOSITORY']}/actions/runs/{env['GITHUB_RUN_ID']}\n")
    with tempfile.TemporaryDirectory(prefix='stroke-release-') as temp:
        note_file = Path(temp) / 'notes.md'
        note_file.write_text(notes, encoding='utf-8')
        if existing.returncode != 0:
            gh('release', 'create', tag, '--draft', '--target', env['GITHUB_SHA'],
               '--title', f"Stroke {version} — build {env['GITHUB_RUN_NUMBER']}",
               '--notes-file', str(note_file))
        gh('release', 'upload', tag, *(str(f) for f in files), '--clobber')
        # Publication happens only after both assets have uploaded successfully.
        gh('release', 'edit', tag, '--draft=false', '--latest')
    print(f'Published https://github.com/{env["GITHUB_REPOSITORY"]}/releases/tag/{tag}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    publish(args.directory, os.environ, dry_run=args.dry_run)
