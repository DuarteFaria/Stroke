import json
import subprocess

import pytest

from scripts.publish_desktop import ROOT, publish


@pytest.fixture
def release(tmp_path):
    version = json.loads((ROOT / 'desktop/package.json').read_text())['version']
    for name in (f'Stroke-{version}-Windows-x64-Setup.exe', f'Stroke-{version}-Windows-x64-Setup.exe.blockmap',
                 'latest.yml', f'Stroke-{version}-macOS-arm64.dmg'):
        (tmp_path / name).write_bytes(b'installer fixture')
    env = dict(GITHUB_REF=f'refs/tags/v{version}', GITHUB_EVENT_NAME='push',
               GITHUB_RUN_NUMBER='42', GITHUB_SHA='abc123',
               GITHUB_REPOSITORY='owner/repo', GITHUB_RUN_ID='1234')
    return tmp_path, env


def fake_github(*, draft=None, fail_upload=False):
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        if args[1:3] == ['release', 'view']:
            return subprocess.CompletedProcess(args, 1 if draft is None else 0,
                                               json.dumps({'isDraft': draft}))
        if fail_upload and args[1:3] == ['release', 'upload']:
            raise subprocess.CalledProcessError(1, args)
        return subprocess.CompletedProcess(args, 0, '')

    return calls, run


def test_failed_upload_leaves_release_unpublished(release):
    calls, run = fake_github(fail_upload=True)
    with pytest.raises(subprocess.CalledProcessError):
        publish(*release, run=run)
    assert any('--draft' in call for call in calls)
    assert not any('--draft=false' in call for call in calls)


def test_retry_resumes_draft_and_publishes_both_assets(release):
    calls, run = fake_github(draft=True)
    publish(*release, run=run)
    assert not any('create' in call for call in calls)
    upload = next(call for call in calls if 'upload' in call)
    assert any(value.endswith('.exe') for value in upload)
    assert any(value.endswith('.dmg') for value in upload)
    assert any(value.endswith('latest.yml') for value in upload)
    assert '--draft=false' in calls[-1]


def test_published_release_is_not_changed(release):
    calls, run = fake_github(draft=False)
    publish(*release, run=run)
    assert not any(call[2] in ('create', 'upload', 'edit') for call in calls)


def test_missing_installer_prevents_any_github_call(release):
    directory, env = release
    next(directory.glob('*.dmg')).unlink()
    calls, run = fake_github()
    with pytest.raises(ValueError, match='Missing or empty'):
        publish(directory, env, run=run)
    assert calls == []


def test_main_branch_cannot_publish(release):
    directory, env = release
    env['GITHUB_REF'] = 'refs/heads/main'
    with pytest.raises(ValueError, match='version tag'):
        publish(directory, env, dry_run=True)


def test_pull_request_cannot_publish(release):
    directory, env = release
    env['GITHUB_EVENT_NAME'] = 'pull_request'
    with pytest.raises(ValueError, match='trusted'):
        publish(directory, env, dry_run=True)


def test_release_notes_reach_the_updater_feed(release):
    directory, env = release
    (directory / 'latest.yml').write_text('version: 0.3.1', encoding='utf-8')
    for _ in range(2):
        calls, run = fake_github(draft=True)
        publish(directory, env, run=run)
    lines = (directory / 'latest.yml').read_text(encoding='utf-8').splitlines()
    assert lines[0] == 'version: 0.3.1'
    assert len(lines) == 2 and lines[1].startswith('releaseNotes: "- ')


def test_missing_changelog_section_prevents_any_github_call(release, tmp_path):
    directory, env = release
    changelog = tmp_path / 'CHANGELOG.md'
    changelog.write_text('## 0.0.1\n\n- Antiga\n', encoding='utf-8')
    calls, run = fake_github()
    with pytest.raises(ValueError, match='CHANGELOG'):
        publish(directory, env, run=run, changelog=changelog)
    assert calls == []
