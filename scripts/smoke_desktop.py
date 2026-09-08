"""Launch the packaged desktop app and require a fresh successful smoke report."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
report = Path(tempfile.gettempdir()) / 'stroke-desktop-smoke' / 'smoke-result.json'
report.unlink(missing_ok=True)
executable = ROOT / ('release/win-unpacked/Stroke.exe' if sys.platform == 'win32'
                     else 'release/mac-arm64/Stroke.app/Contents/MacOS/Stroke')
# A generated, non-personal clip exercises decoding and both bundled pose models.
# No visible athlete is expected; the test checks execution, not tracking quality.
import cv2
import numpy as np

video = ROOT / 'build/smoke-analysis.mp4'
video.parent.mkdir(parents=True, exist_ok=True)
writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*'mp4v'), 10, (320, 240))
if not writer.isOpened():
    raise RuntimeError('Could not create smoke video')
try:
    for _ in range(10):
        writer.write(np.zeros((240, 320, 3), dtype=np.uint8))
finally:
    writer.release()
env = {**os.environ, 'STROKE_SMOKE_ANALYSIS_VIDEO': str(video)}
subprocess.run([str(executable), '--smoke-test'], env=env, check=True, timeout=240)
result = json.loads(report.read_text(encoding='utf-8'))
print(json.dumps(result, indent=2, ensure_ascii=False))
if not result.get('ok'):
    raise RuntimeError('Packaged desktop smoke test failed')
