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

- One blade entry counts as one stroke. Cadence is 60 divided by the mean time
  between consecutive confirmed alternating catches in the selected segment.
- Time in water is the exit minus the preceding same-side catch. The displayed
  left/right values are means over complete confirmed pairs.
- Unreviewed/ignored markers interrupt pairing. Missing exits, duplicate times,
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
