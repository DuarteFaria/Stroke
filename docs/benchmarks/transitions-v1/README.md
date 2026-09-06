# Marked transition handling

This first version uses user-marked intervals, not automatic cut or crossfade
detection. Automatic detection remains pending. Camera pans and rapid paddling
must not be mistaken for edits by an unvalidated image-difference threshold.

## Reference review

The [contact sheet](transition-review.jpg) samples sideTransition1 from 1.40 to
3.05 seconds at 0.15-second spacing. A conservative manually reviewed exclusion
interval is **1.55–2.45 seconds**. This is a coarse transition annotation, not
frame-exact ground truth or a set of manually annotated anatomical landmarks.
The incoming shot is visually clear by 2.45 seconds.

## Result

Full model, 15 fps, full frame, follow disabled. The saved project excludes 13
sampled frames in the interval, including the 2.20-second frame that previously
tracked the fading athlete. The detector is recreated after the interval and
finds a pose at **2.4667 seconds**, the first available post-interval sample
(about 17 ms after the marked end). See [recovery overlays](recovery.jpg).
The shoulder/arm skeleton follows the incoming athlete in the two reviewed
post-transition frames, but joint error has not been measured.

This removes ambiguous samples by design; it does not recover anatomy from the
blended images. Lower overall coverage is expected. Do not count deliberately
excluded transition samples as ordinary detector failures when evaluating recovery.

## Workflow

Open **Transições** above Notes. Pause at the start of a cut/fade and choose
**Marcar início**, then seek to its end and choose **Marcar fim**. Rerun detection.
Intervals can be removed; overlapping intervals are merged. They persist with
the project. Existing detections change only when analysis is rerun.

Excluded samples have null poses. The first frame after a transition carries a
restart marker that also prevents interpolation across very short marked edits.
Follow mode resets to the original selected region. It does not identify the
athlete in a new shot; use a separate segment/selection if that shot needs a
different crop. Paddle annotations and manually marked stroke events remain
unchanged and need review around edits.

Reproduce with `analyze(video, 0, duration, transitions=[[1.55, 2.45]])`.
Tests cover interval validation, exclusion, detector recreation/cleanup,
project roundtrip and interpolation across a restart.
