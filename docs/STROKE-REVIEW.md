# Stroke timing review

The new flow is available in the source desktop build. Run `Start-Desktop.ps1`
from this checkout after building the UI; an older installed application does
not receive these changes automatically.

## Trying it

1. Open a clip and choose **Analisar a minha pagaiada**.
2. Use **+ Entrada** and **+ Saída** beneath the timeline to mark the current
   frame. Choose the athlete's side first. Analysis does not generate marks.
3. Click a marker to replay nearby footage. Use **Ajustar** to move it by frames,
   change its side/type, or choose **Marcar aqui** at the current video frame.
4. **Concluir** confirms an adjustment. **Remover** removes the selected marker;
   the sidebar's **Anular** button or Ctrl+Z undoes edits and removals.
5. The left toolbar switches between **Editar** (body/paddle tools) and
   **Resumo** (confirmed timing). Detail and athlete-area controls sit immediately
   before the main analysis button.
6. Save the `.stroke.json` project and keep its original video. Existing saved
   automatic suggestions remain reviewable, but new ones are no longer generated.

For feedback, send the saved project and identify the source clip. Tell us which
suggestions were early/late, on the wrong side, missing, or unnecessary, and where
the workflow felt confusing. These projects can supply reviewed examples, but
are not independent ground truth until checked by a knowledgeable reviewer.

## What the numbers mean

### Comparing strokes

Choose **Comparar** in the left toolbar. **Pagaiada a pagaiada** lets you select
two strokes (optionally filtering by side), compare their contact, recovery and
cycle times, and replay either one. **Esquerda / direita** shows each side's mean,
sample count and range, plus the signed right-minus-left difference.

A contact time needs a confirmed catch/exit pair. Recovery and cycle duration
also need the next same-side catch and one confirmed opposite catch in between.
Ambiguous or unreviewed markers and camera cuts interrupt cycles. The final
contact pair can therefore have a contact time without a complete cycle.

For a desktop comparison smoke test on Windows, build the UI with
`pnpm exec vite build --config vite.desktop.config.ts` from `app`, then run
`.venv/Scripts/python.exe scripts/smoke_comparisons.py` from the repository root.
It uses synthetic annotations and `docs/videos/front1.mp4` for playback only;
an alternate local video of at least three seconds can be passed as an argument.
Screenshots are saved under `build/comparison-screenshots`.

### Timing summary

- One blade entry counts as one stroke. Cadence is 60 divided by the mean time
  between consecutive confirmed alternating catches in the selected segment.
- Time in water is the exit minus the preceding same-side catch. The displayed
  left/right values are means over complete confirmed pairs.
- Unreviewed markers interrupt pairing. Removed markers are ignored in all timing calculations. Missing exits, duplicate times,
  marked camera transitions, and tracking restarts do not form complete pairs.
- Legacy manual markers count as reviewed. New automatic markers never count
  until confirmed. Changing an existing marker requires confirmation again.
- There is no technique score, efficiency claim, or automatic coaching verdict.

## Retired detector v1 and validation

The unused experimental detector in `app/lib/strokes.ts` uses visible same-side shoulder/elbow/wrist samples, a short
smoothing window, and bounded downward wrist excursions relative to the shoulder.
It normalizes by projected upper-arm length and proposes entry/exit candidates
at excursion threshold crossings. These are arm-motion proxies, not observations
of the blade touching water. The thresholds are heuristic, not calibrated
probabilities. Camera roll, wrist-tracking errors, arm foreshortening, and differing
techniques can shift or invalidate the suggestions.

The detector stops at low-confidence samples, gaps, restarts and marked transitions.
It may miss an entire clip. No fallback fabricates water-contact timestamps when
there are no candidates; guided manual marking remains available.

Unit tests cover calculations, gaps, low confidence, stationary motion, transition
boundaries, duplicate markers, review preservation and project validation. Desktop
smoke tests exercise real inference, marker adjustment/confirmation/undo, saving
and recovery. These tests verify behavior, not biomechanical detection accuracy.
The candidate inventory in `benchmarks/strokes-v1.json` records existing fixture
coverage only; human-reviewed catches/exits are still needed to measure error.
