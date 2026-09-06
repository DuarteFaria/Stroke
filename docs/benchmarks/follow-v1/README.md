# Experimental region following

Enable **Seguir** after choosing an athlete area, then rerun detection. Off by
default. The initial area stays editable; the analysed crop is saved per frame
and shown during playback. Orange means the follower could not trust the shoulder
observations. No persistent explanatory text was added to the controls.

The follower translates a fixed-size crop by shoulder-centre displacement. It
requires both shoulders at confidence >= .7, inside the crop, and rejects a
single-step displacement exceeding 12% of crop width or height. Uncertain samples
freeze the crop and reset the displacement anchor. It does not zoom, identify
people, detect cuts, or reacquire an athlete outside the crop. Another person
entering the crop can still be selected. Confidence is not an accuracy measure.

## Initial comparison

Used the same initial regions, full segments, Full model and 15 fps as crop-v1.
Both clips retain 100% pose coverage. The final region moves horizontally by
approximately 6.1% of frame width in multiple2 and 3.4% in side1. No sample in
these two runs triggered the uncertainty guard; guard behaviour is unit tested.

Three frames per clip were visually inspected: [overlays](overlays.jpg).
The intended left paddler remains selected in the multiple2 spot checks. This
does not prove identity preservation over every frame.

Multiple2 wrist confidence coverage regresses from 94.1% / 75.6% (fixed crop) to
91.6% / 68.9% (following). Therefore this feature remains optional and experimental;
these results do not establish better joint accuracy. Full per-joint reports and
reviewable projects are in this folder. Manual reference annotations, more motion
examples, and transition recovery are still required before enabling by default.

To reproduce, open either crop-v1 project, reconnect its video, enable **Seguir**,
run detection and save to a new project. The backend equivalent is
`analyze(video, start, end, region=initial_region, follow=True)`.
