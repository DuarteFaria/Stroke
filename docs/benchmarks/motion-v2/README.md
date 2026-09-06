# Consecutive jumps and cautious leg display

Reproduced the reported diagonal1 sequence using its saved Standard baseline.
The user's approximate 1.12s observation corresponds to the 1.1333s sample in
the 15 fps analysis. The original flag was at 1.0667s.

In the [source-frame overlays](diagonal-review.jpg), the left wrist is misplaced
at 1.000s and 1.1333s, with a recovery at 1.0667s. A three-frame spike detector
can flag the recovery rather than the bad surrounding estimates. Therefore these
are review candidates, not assertions that the flagged frame alone is wrong.

The updated rules preserve the original isolated-spike test and add a bounded
second pass: within .14s of an existing flag for the same joint, check for a sharp
direction reversal, substantial displacement on both sides, and a significant
interpolation residual. This pass does not recursively propagate new flags.
The new list includes 1.000, 1.0667 and 1.1333s. A real-fixture regression test
checks the missed frame and verifies that restarts block the local test.

Knees and ankles are now included in jump/swap review. For display and knee-angle
measurement, each hip/knee/ankle chain requires all three confidences >= .8 and no
nearby leg flag (within .12s). Otherwise it is shown uncertain and its angle is
suppressed. Source positions and confidence remain unchanged. The same gate is
used for the ideal comparison. Raw overlay remains available as the detector
output. This does not identify boat occlusion or guarantee high-confidence legs
are correct; sustained, confident hallucinations remain possible.

No coordinates are repaired or smoothed. The changes also affect loaded projects
without reanalysis. Tests cover consecutive real footage errors, fast steady
motion, swaps, missing poses, restarts, leg angle suppression and raw preservation.
Independent annotation and broader false-positive review are still needed.
