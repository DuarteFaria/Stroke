"""Run the unchanged detector on local MP4 clips and save reviewable projects."""
import argparse
import hashlib
import json
import platform
import subprocess
import time
from pathlib import Path

from backend import main as analyzer
from backend.benchmark import summarize


def write_json(path, value):
    with path.open('x', encoding='utf-8') as target:
        json.dump(value, target, indent=2, allow_nan=False)
        target.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('videos', type=Path)
    parser.add_argument('--model', type=Path, default=analyzer.MODEL)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    clips = sorted(args.videos.glob('*.mp4'))
    if not clips or not args.model.is_file():
        parser.error('Provide a folder containing MP4 clips and an existing pose model.')
    args.output.mkdir(parents=True, exist_ok=False)
    analyzer.MODEL = args.model.resolve()
    report = {'schemaVersion': 1, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'platform': platform.platform(), 'python': platform.python_version(),
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'workingTreeStatus': subprocess.check_output(['git', 'status', '--short'], text=True),
              'analyzerSha256': hashlib.sha256(Path(analyzer.__file__).read_bytes()).hexdigest(),
              'model': args.model.name,
              'modelSha256': hashlib.sha256(args.model.read_bytes()).hexdigest(),
              'settings': {'maxSampleFps': 15, 'maxImageDimension': 1280,
                           'numPoses': 1, 'detectionConfidence': 0.4,
                           'presenceConfidence': 0.4, 'trackingConfidence': 0.5},
              'reports': []}
    for clip in clips:
        print(f'Analyzing {clip.name}...', flush=True)
        meta = analyzer.inspect_video(clip)
        end = min(meta['duration'], 120)
        started = time.perf_counter()
        result = analyzer.analyze(clip, 0, end)
        elapsed = time.perf_counter() - started
        project = {'version': 1, 'name': clip.stem + ' baseline',
                   'video': {'name': clip.name, 'size': clip.stat().st_size,
                             **{k: meta[k] for k in ('duration', 'width', 'height', 'fps')}},
                   'segment': [0, end], 'frames': result['frames'],
                   'corrections': [], 'target': [], 'paddle': [], 'targetPaddle': [],
                   'events': [], 'notes': 'Unedited baseline. Coverage is not accuracy.',
                   'targetEnabled': False}
        write_json(args.output / (clip.stem + '.stroke.json'), project)
        summary = summarize(project)
        summary.update(source=clip.name, sourceSha256=hashlib.sha256(clip.read_bytes()).hexdigest(),
                       elapsedSeconds=elapsed, sampleFps=result['sampleFps'],
                       video=project['video'])
        report['reports'].append(summary)
        print(f"  {summary['detectedSamples']}/{summary['samples']} poses; {elapsed:.1f}s", flush=True)
    write_json(args.output / 'report.json', report)


if __name__ == '__main__':
    main()
