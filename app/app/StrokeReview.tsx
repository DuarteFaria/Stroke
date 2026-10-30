import { useMemo } from 'react';
import type { Project } from '@/lib/motion';
import { strokeSummary } from '@/lib/strokes';

/* The entry/exit markers and their actions live on the timeline dock now
   (Timeline.tsx); this file keeps the timing summary shown in the inspector. */
const seconds = (n: number | null) => n === null ? '—' : `${n.toFixed(2)} s`;

export function TimingSummary({project: p}: {project: Project}) {
  const summary = useMemo(() => strokeSummary(p), [p]);
  return <div id="timing-summary" className="timing-summary">
      <p>Apenas marcações confirmadas · {summary.pairs.length} {summary.pairs.length === 1 ? 'remada completa' : 'remadas completas'}</p>
      <dl><div><dt>Remadas / min</dt><dd>{summary.rate === null ? '—' : summary.rate.toFixed(0)}</dd></div><div><dt>Esquerda na água</dt><dd>{seconds(summary.left)}</dd></div><div><dt>Direita na água</dt><dd>{seconds(summary.right)}</dd></div></dl>
    </div>;
}
