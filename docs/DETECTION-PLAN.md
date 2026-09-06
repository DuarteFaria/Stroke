# Better 2D detection

This phase focuses on recorded footage. Live capture and 3D are deferred.
Success means more correct landmarks and less manual correction, with processing
time reported alongside quality. More confident or smoother output alone is not success.

## 1. Establish the baseline — first run complete, reference annotation pending

The [first 12-video baseline](benchmarks/README.md) includes raw projects, coverage
results and visual spot checks. Identity switches and crossfade failures confirm
that coverage alone is insufficient. Independent joint annotation and correction
effort measurements remain pending.

Choose 6–10 short continuous clips covering clear footage, small/distant athletes,
blur, low light, occlusion, and multiple paddlers. Include different views and
both stroke sides. Keep original files local and use the same segments for each run.
The example project is useful for exercising the report, not a validated dataset.

For every clip, record:

| Field | What to record |
| --- | --- |
| Identity | Clip ID, source filename, segment start/end, view and difficulty |
| Run | Git commit, model, settings, computer, analysis elapsed seconds |
| Coverage | Raw pose and shoulder/elbow/wrist/hip coverage from the report |
| Accuracy | Manually reviewed joint locations at fixed timestamps, including catch/exit |
| Failures | Left/right swaps, wrong athlete, lost tracking, recovery time |
| Effort | Correction minutes for the same reviewed segment |

Save an unedited analysis project for each run. Generate comparable reports with:

```powershell
.venv/Scripts/python.exe -m backend.benchmark baseline.stroke.json --output baseline-report.json
.venv/Scripts/python.exe -m backend.benchmark candidate.stroke.json --output candidate-report.json
```

Multiple project paths may precede `--output`. Output must be a new file.
This command uses only Python's standard library and never modifies projects.
Coverage uses every sampled frame as its denominator, including missed detections.
It is not an accuracy score. Do not treat existing correction offsets as ground truth:
they include interpolation support anchors. Establish independent manual reference
points on the original frames; mark invisible joints unscorable. Compare positional
error at the same timestamps and resolution, separately from coverage. Keep some
clips held out from tuning. Manual reference scoring is not yet automated.

Exit: reviewed reference frames and baseline results exist for the chosen clips.

## 2. Athlete selection and cropping

An [experimental follow mode](benchmarks/follow-v1/README.md) now translates the
crop using reliable shoulders and saves its path for review. It is off by default:
the first comparison shows no proven accuracy gain. Automatic reacquisition and
transition recovery remain pending.

Implemented the first fixed-region version: draw a rectangle, save/reopen it with
the project, analyse original pixels inside it, and map joints back to the full
video. Full-frame analysis remains available. With follow disabled, the athlete
must remain inside the selected fixed area.
See [initial crop comparison](benchmarks/crop-v1/README.md).

Add a selectable region with enough margin for the complete arm movement. Crop
from original decoded pixels before downscaling, map results back to video coordinates,
and show the selection in the editor. Then add region tracking and explicit recovery
when the athlete leaves it. Preserve full-frame fallback and saved project compatibility.

Exit: fewer wrong-athlete failures and lower error on distant-athlete clips, without
losing wrists at crop edges. Verify crop coordinate mapping and moving subjects.

## 3. Accurate analysis mode

Implemented optional **Detalhada** (Heavy, up to 30 fps); standard remains Full
at up to 15 fps. See the [three-clip model/sampling comparison](benchmarks/quality-v1/README.md).
Selection and per-frame model identity persist in projects. Accuracy annotation
and correction-effort evaluation are still pending.

Compare Full and Heavy models plus increased sampling rates, changing one setting
at a time. Save analysis settings and model identity with results. Keep cancellation
and progress responsive. Measure runtime on the target Windows machine.

Exit: publish per-clip accuracy, coverage, correction effort and runtime comparisons;
choose the default from evidence. Package any additional model explicitly.

## 4. Tracking continuity

Added [review-only wrist/elbow candidates](benchmarks/motion-v1/README.md) and
provisional visual references. No raw joints are changed. The two initial clips
produce no isolated-jump flags; real-example precision/recall and independent
reference review remain pending.

Implemented [marked transition intervals](benchmarks/transitions-v1/README.md):
exclude blends, recreate detection afterward, and prevent interpolation across
the restart. The sideTransition1 spot check recovers on the first post-interval
sample. Automatic transition detection, anatomical reference annotation, joint
outlier handling, and short-gap recovery remain pending.

Add confidence-aware outlier handling and short-gap recovery. Preserve raw detections
alongside processed results. Treat camera cuts and prolonged occlusion as breaks.
Do not fill hidden joints with high-confidence guesses or shift catch/exit timing.

Exit: fewer reviewed jumps/swaps with unchanged or improved event timing and joint error.

## 5. Correction propagation

Use edits to guide nearby tracking, with a bounded range, preview and undo. Distinguish
manual observations from inferred points and preserve the original analysis.

Exit: less correction time on the benchmark without degrading surrounding frames.
