"""Summarize raw Stroke detections without loading video or inference dependencies."""
import argparse
import json
import math
from pathlib import Path

JOINTS = {11: 'left_shoulder', 12: 'right_shoulder', 13: 'left_elbow',
          14: 'right_elbow', 15: 'left_wrist', 16: 'right_wrist',
          23: 'left_hip', 24: 'right_hip'}


def summarize(project, threshold=0.5):
    """Coverage measures availability, never anatomical accuracy.

    Corrections are intentionally excluded: saved corrections include automatic
    support anchors and are not independent ground-truth annotations.
    """
    if not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError('Confidence threshold must be between 0 and 1.')
    start, end = project['segment']
    frames = [f for f in project['frames'] if start <= f['t'] <= end]
    times = [f['t'] for f in frames]
    if any(not math.isfinite(t) for t in times) or any(
            b <= a for a, b in zip(times, times[1:])):
        raise ValueError('Frame timestamps must be finite and strictly increasing.')
    for frame in frames:
        points = frame['points']
        if points is not None and (len(points) != 33 or any(
                not all(math.isfinite(p[k]) for k in ('x', 'y', 'v'))
                or not 0 <= p['v'] <= 1 for p in points)):
            raise ValueError('Expected 33 finite landmarks with confidence in [0, 1].')
    total = len(frames)
    detected = sum(f['points'] is not None for f in frames)
    coverage = {}
    for joint, name in JOINTS.items():
        usable = sum(f['points'] is not None and
                     f['points'][joint]['v'] >= threshold for f in frames)
        coverage[name] = {'usableSamples': usable,
                          'coveragePercent': 100 * usable / total if total else None}
    return {'name': project['name'], 'segment': [start, end],
            'samples': total, 'detectedSamples': detected,
            'missingSamples': total - detected,
            'poseCoveragePercent': 100 * detected / total if total else None,
            'confidenceThreshold': threshold, 'joints': coverage,
            'note': 'Raw sampled-frame coverage only; confidence is not accuracy. '
                    'Manual corrections and playback interpolation are excluded.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('projects', nargs='+', type=Path)
    parser.add_argument('--threshold', type=float, default=0.5)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        reports = [summarize(json.loads(p.read_text(encoding='utf-8-sig')),
                             args.threshold) for p in args.projects]
        # Never overwrite an existing baseline or an input project.
        with args.output.open('x', encoding='utf-8') as target:
            json.dump({'schemaVersion': 1, 'reports': reports}, target,
                      indent=2, allow_nan=False)
            target.write('\n')
    except (OSError, ValueError, KeyError, TypeError) as exc:
        parser.exit(1, f'Benchmark failed: {exc}\n')


if __name__ == '__main__':
    main()
