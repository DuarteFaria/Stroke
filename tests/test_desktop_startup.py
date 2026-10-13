"""The packaged entry must restore the cache before importing MediaPipe."""
import os
import subprocess
import sys


def test_entry_restores_persistent_cache_before_imports(tmp_path):
    cache = tmp_path / 'persistent-cache'
    env = {**os.environ, 'STROKE_MPL_CACHE': str(cache), 'MPLCONFIGDIR': str(tmp_path / 'pyinstaller-temporary')}
    # Exercise the actual entry module and third-party imports without starting a server.
    script = ('import runpy; runpy.run_path("backend/desktop_entry.py", run_name="cache_test"); '
              'import matplotlib; print(matplotlib.get_cachedir())')
    for _ in range(2):
        result = subprocess.run([sys.executable, '-c', script], env=env, capture_output=True, text=True, check=True)
        assert result.stdout.strip().splitlines()[-1] == str(cache)
        assert cache.is_dir()
