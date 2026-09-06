# Motion review candidates

Open **Rever movimento** above Notes. Each candidate seeks to the sampled frame
and selects the wrist/elbow for manual correction. It works on existing saved
projects without reanalysis. It never changes raw coordinates or confidence,
and corrections do not erase the original flags. No automatic repair is enabled.

## Detection rules

Three adjacent samples, no marked transitions/restarts, positive gaps <=120 ms.
An isolated jump must differ from time-weighted neighbour interpolation by more
than .65 of the median visible upper-arm length, while its neighbours agree
within .45 of that length. Neighbour confidence must be >=.7. Possible temporary
left/right swaps require confident, separated joints and substantially better
agreement when the two middle-frame labels are exchanged. Distances account
for video aspect ratio. These are initial heuristic thresholds, not validated
biomechanical limits. Fast reversals can still be flagged incorrectly.

## Reference work

Prepared three source-frame views for each of back2 and shortclose1, approximately
0.267, 0.667 and 1.067 seconds (30 fps indices 8, 20 and 32). The reference sheets
use 960x540 frames plus title strips. `references.json` contains 16 provisional
visual wrist/elbow locations, with a rough 15-pixel uncertainty at that size;
ambiguous/occluded joints are explicitly unscorable. These are assistant-estimated
annotations requiring independent review, not validated ground truth. No detector
coordinates were used to select the reference positions.

`reference-errors.json` compares those points to the original baseline at matching
timestamps. Small differences within annotation uncertainty are not meaningful.
Side assignment and estimates also need human review before model ranking.

## Result and limits

The initial rules produce **zero candidates** on both baseline clips. This does
not mean their poses are correct: sustained misplacement, hidden joints, long
swaps and missed detections are outside this detector's scope. There is no
demonstrated reduction in correction effort yet. Unit tests show isolated spikes
and temporary swaps are flagged, steady fast movement is preserved, and missing
frames/restarts are respected. Additional positive real-video examples and
reviewed labels are needed to measure precision/recall before enabling repairs.
