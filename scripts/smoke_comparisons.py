"""Exercise comparison controls in the source desktop build with synthetic poses.

Build app/desktop-dist first. Pass an optional local video of at least 3 seconds;
the video is used only for decoding/replay, not as a biomechanics reference.
"""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile

import cv2

ROOT = Path(__file__).resolve().parent.parent
video = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / 'docs/videos/front1.mp4'
capture = cv2.VideoCapture(str(video))
fps = capture.get(cv2.CAP_PROP_FPS)
duration = capture.get(cv2.CAP_PROP_FRAME_COUNT) / fps if fps else 0
if duration < 3:
    raise ValueError('Choose a decodable video of at least 3 seconds.')
metadata = dict(name=video.name, size=video.stat().st_size, duration=duration,
                width=int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
                height=int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)), fps=fps)
capture.release()
project = dict(version=1, name='Synthetic comparison smoke', video=metadata,
               segment=[0, 3], frames=[], corrections=[], target=[], paddle=[],
               targetPaddle=[], targetEnabled=False, notes='Synthetic test poses, not measurements of this athlete.')
events = [('a', 0, 'Catch', 'Left'), ('b', .3, 'Exit', 'Left'),
          ('c', .5, 'Catch', 'Right'), ('d', .9, 'Exit', 'Right'),
          ('e', 1, 'Catch', 'Left'), ('f', 1.3, 'Exit', 'Left'),
          ('g', 1.5, 'Catch', 'Right'), ('h', 1.9, 'Exit', 'Right'),
          ('i', 2, 'Catch', 'Left')]
project['events'] = [dict(id=i, t=t, kind=k, side=s, review='confirmed') for i, t, k, s in events]
for i in range(91):
    points = [dict(x=.5, y=.5, v=1) for _ in range(33)]
    points[11]['x'], points[12]['x'] = .4, .6
    points[15] = dict(x=.49 + .07 * math.sin(i / 30 * 2 * math.pi), y=.7, v=1)
    points[16] = dict(x=.51 + .07 * math.sin(i / 30 * 2 * math.pi), y=.7, v=1)
    project['frames'].append(dict(t=i / 30, points=points))
fixture = ROOT / 'build/comparison-smoke.stroke.json'
fixture.parent.mkdir(exist_ok=True)
fixture.write_text(json.dumps(project), encoding='utf-8')
report = Path(tempfile.gettempdir()) / 'stroke-desktop-smoke/smoke-result.json'
report.unlink(missing_ok=True)
executable = ROOT / 'desktop/node_modules/electron/dist/electron.exe'
env = {**os.environ, 'STROKE_SMOKE_PROJECT': str(fixture), 'STROKE_SMOKE_VIDEO': str(video),
       'STROKE_SMOKE_COMPARISONS': '1', 'STROKE_SCREENSHOT_DIR': str(ROOT / 'build/comparison-screenshots')}
subprocess.run([str(executable), str(ROOT / 'desktop'), '--smoke-test'], cwd=ROOT,
               env=env, check=True, timeout=90)
result = json.loads(report.read_text(encoding='utf-8'))
print(json.dumps(result, indent=2, ensure_ascii=False))
if not result.get('ok'):
    raise RuntimeError('Comparison smoke test failed')
