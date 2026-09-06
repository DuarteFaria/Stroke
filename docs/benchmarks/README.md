# First video baseline — 2026-09-06

Analysed all 12 supplied clips, full duration, with the unchanged Full-model CPU pipeline at 15 fps. Sources remain in the original desktop project under `docs/videos`; this worktree stores reports and unedited projects. Reconnect each source video when opening a baseline project.

## Results

Percentages below measure sampled-frame availability at confidence >= 0.5, not correct anatomy or athlete identity. Left/right refer to model joint labels.

| Clip | Samples | Pose coverage | Left wrist | Right wrist | Runtime (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| back1.mp4 | 27 | 100.0% | 70.4% | 63.0% | 1.07 |
| back2.mp4 | 21 | 95.2% | 42.9% | 47.6% | 1.09 |
| diagonal1.mp4 | 36 | 100.0% | 97.2% | 100.0% | 1.77 |
| diagonalTransition1.mp4 | 77 | 100.0% | 77.9% | 72.7% | 3.44 |
| front1.mp4 | 124 | 98.4% | 98.4% | 95.2% | 5.08 |
| multiple1.mp4 | 119 | 95.8% | 63.9% | 95.8% | 5.13 |
| multiple2.mp4 | 119 | 98.3% | 98.3% | 75.6% | 5.01 |
| shortclose1.mp4 | 20 | 100.0% | 25.0% | 75.0% | 1.03 |
| side1.mp4 | 29 | 100.0% | 48.3% | 100.0% | 0.87 |
| sideTransition1.mp4 | 66 | 98.5% | 75.8% | 98.5% | 1.80 |
| sideTransition2.mp4 | 88 | 100.0% | 35.2% | 98.9% | 1.84 |
| tech1.mp4 | 84 | 100.0% | 100.0% | 61.9% | 1.76 |

## Visual observations

Reviewed three sampled frames per clip (approximately 20%, 50%, 80%); this is a spot check, not frame-by-frame ground truth. See [original frames](contact-sheet.jpg) and [overlays](baseline-overlays.jpg). Green means confidence >= 0.5; orange means lower confidence.

- `multiple2`: detector follows the right-hand paddler at 1.60s and the left-hand paddler at 4.00s and 6.33s. High pose coverage conceals an identity switch.
- `sideTransition1`: at 2.20s the skeleton remains on the small fading athlete during a crossfade, rather than the larger incoming image. Treat edited footage as a separate stress test.
- `back2`: wrist confidence coverage is under 50% for both sides. Rear-view arm overlap needs reference review.
- `shortclose1`: close framing does not guarantee reliable wrists; left-wrist coverage is only 25%.
- The set contains single-blade canoe footage as well as double-blade kayaking. Record discipline with future annotations.
- Every file is 1920x1080 at 30 fps, but visible sharpness and subject size vary. Resolution alone is not a useful quality label.

## Benchmark allocation

Use `diagonal1`, `back2`, `side1`, `shortclose1`, `multiple2`, and `sideTransition1` for the first development comparisons. Reserve `back1`, `diagonalTransition1`, `front1`, `multiple1`, `sideTransition2`, and `tech1` from parameter tuning. These are clip-level reserves, not an independent evaluation dataset: some footage appears to share sessions or source material.

Next implementation: athlete selection/cropping, evaluated especially on `multiple2` and `side1`. Follow with tracking reset/reacquisition around transitions. Before accuracy claims, manually annotate visible joints at fixed timestamps and record the intended athlete; occluded joints remain unscorable. Correction effort and positional error have not yet been measured.

## Reproduce

```powershell
python -m backend.benchmark_videos "C:/Users/Duarte/Desktop/kayak technique/docs/videos" --model "C:/Users/Duarte/Desktop/kayak technique/models/pose_landmarker_full.task" --output docs/benchmarks/baseline-v2
```

Use a new output directory for each run. `baseline-v1/report.json` records source/model/analyzer hashes, commit, working-tree status, settings and runtime. Each `.stroke.json` is an unedited review project.
