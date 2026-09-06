# Fixed-region experiment

The same Full model and 15 fps sampling were used as baseline-v1. Only the crop
changed. Regions are normalized full-video coordinates and are saved in each
project and report. Review [sample overlays](overlays.jpg); yellow is the crop,
green is confidence >= 0.5, orange is lower confidence.

| Clip | Region x/y/width/height | Pose coverage before → after | Left wrist before → after | Right wrist before → after |
| --- | --- | --- | --- | --- |
| multiple2 | .02 / .15 / .50 / .70 | 98.3% → 100% | 98.3% → 94.1% | 75.6% → 75.6% |
| side1 | .25 / .20 / .50 / .65 | 100% → 100% | 48.3% → 48.3% | 100% → 100% |

In the three reviewed multiple2 frames (1.60, 4.00, 6.33 seconds), the crop
consistently selects the left-hand paddler, whereas the baseline switches between
paddlers. These coverage figures therefore describe different people in some
frames; they cannot establish improved joint accuracy. The crop is tight at the
left edge; this experiment does not demonstrate complete arm containment.

The side1 experiment shows no wrist coverage gain. Manual reference annotation
and a full-frame-by-frame identity review remain pending. Do not infer an accuracy
improvement or elimination of all switches from these spot checks.

## Use in Stroke

1. Choose a continuous segment and click **Selecionar área do atleta**.
2. Drag a rectangle around the athlete, leaving room for the entire arm movement.
3. Review the segment to check containment, then click **Detetar o atleta**.
4. Use **Usar vídeo inteiro** and rerun detection to remove the crop.

The region is fixed across the segment. It does not follow a moving athlete,
identify a person when another enters the box, or recover across camera cuts.
Changing the region does not change existing detections until analysis is rerun.
