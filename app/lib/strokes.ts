import type { EventMark, Project } from './motion';

export const reviewed = (e: EventMark) => e.review === 'confirmed' || (!e.review && e.source !== 'automatic');
export function crossesBreak(p: Pick<Project, 'frames' | 'transitions'>, a: number, b: number) {
  return (p.transitions || []).some(([s, e]) => s <= b && e >= a) ||
    p.frames.some(f => f.t > a && f.t <= b && (f.breakBefore || f.transition));
}

/** Initial image-plane heuristic, NOT a water-contact detector. A lower-wrist
 * excursion supplies two review candidates. Bounded excursions, visible arms
 * and wrists, and uninterrupted samples are required. No contact is confirmed.
 * Thresholds must be assessed against independent athlete/coach annotations. */
export function suggestStrokes(p: Pick<Project, 'frames' | 'segment' | 'transitions' | 'video'>): EventMark[] {
  const out: EventMark[] = [];
  const aspect = p.video.width / (p.video.height || 1);
  for (const [side, wrist, shoulder, elbow] of [['Left', 15, 11, 13], ['Right', 16, 12, 14]] as const) {
    let run: { t: number; y: number }[] = [];
    const flush = () => {
      if (run.length < 7) { run = []; return; }
      const sm = run.map((s, i) => ({ t: s.t, y: (run[Math.max(0, i-1)].y + s.y + run[Math.min(run.length-1, i+1)].y) / 3 }));
      const lows: number[] = [0];
      for (let i = 1; i < sm.length - 1; i++) {
        if (sm[i].y <= sm[i-1].y && sm[i].y < sm[i+1].y) lows.push(i);
      }
      lows.push(sm.length - 1);
      for (let k = 1; k < lows.length; k++) {
        const a = lows[k-1], b = lows[k];
        const duration = sm[b].t - sm[a].t;
        if (duration < .35 || duration > 3) continue;
        let peak = a;
        for (let i = a + 1; i < b; i++) if (sm[i].y > sm[peak].y) peak = i;
        const base = Math.max(sm[a].y, sm[b].y);
        const amplitude = sm[peak].y - base;
        if (amplitude < .25) continue;
        const level = base + amplitude * .45;
        let entry = a, exit = b;
        while (entry < peak && sm[entry].y < level) entry++;
        while (exit > peak && sm[exit].y < level) exit--;
        if (sm[exit].t - sm[entry].t < .1) continue;
        for (const [kind, i] of [['Catch', entry], ['Exit', exit]] as const) {
          const t = sm[i].t;
          out.push({ id: `auto-v1-${side}-${kind}-${t.toFixed(6)}`, t, kind, side,
            source: 'automatic', review: 'suggested', originalT: t });
        }
      }
      run = [];
    };
    for (const f of [...p.frames].sort((a, b) => a.t - b.t)) {
      if (f.t < p.segment[0] || f.t > p.segment[1]) continue;
      const points = f.points;
        if (!points || ![wrist, shoulder, elbow].every(j => points[j] && points[j].v >= .65) ||
        f.transition || (p.transitions || []).some(([a, b]) => f.t >= a && f.t <= b)) { flush(); continue; }
      if (f.breakBefore || (run.length && (f.t - run[run.length-1].t > .18 || f.t <= run[run.length-1].t))) flush();
      const scale = Math.hypot((points[shoulder].x - points[elbow].x) * aspect, points[shoulder].y - points[elbow].y);
      // A strongly foreshortened arm cannot provide a stable scale.
      if (scale < .025) { flush(); continue; }
      const y = (points[wrist].y - points[shoulder].y) / scale;
      if (!Number.isFinite(y)) { flush(); continue; }
      run.push({ t: f.t, y });
    }
    flush();
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Preserve reviewed, adjusted, skipped and legacy manual annotations on rerun. */
export function mergeSuggestions(events: EventMark[], suggestions: EventMark[], segment: [number, number]) {
  const keep = events.filter(e => e.t < segment[0] || e.t > segment[1] || e.source !== 'automatic' || e.review !== 'suggested');
  return [...keep, ...suggestions.filter(s => !keep.some(e => e.id === s.id ||
    (e.side === s.side && e.kind === s.kind && (Math.abs(e.t - s.t) < .25 ||
      (e.originalT !== undefined && Math.abs(e.originalT - s.t) < .25)))))]
    .sort((a, b) => a.t - b.t);
}

export function strokeSummary(p: Pick<Project, 'events' | 'frames' | 'transitions' | 'segment'>) {
  const events = p.events.filter(e => e.t >= p.segment[0] && e.t <= p.segment[1]).sort((a,b) => a.t-b.t);
  const pairs: { catch: EventMark; exit: EventMark; duration: number }[] = [];
  let incomplete = 0;
  for (const side of ['Left', 'Right']) {
    let start: EventMark | undefined;
    for (const e of events.filter(e => e.side === side)) {
      if (!reviewed(e)) { if (start) incomplete++; start = undefined; continue; }
      if (e.kind === 'Catch') { if (start) incomplete++; start = e; }
      else {
        if (start && e.t > start.t && !crossesBreak(p, start.t, e.t)) pairs.push({ catch: start, exit: e, duration: e.t-start.t });
        else incomplete++;
        start = undefined;
      }
    }
    if (start) incomplete++;
  }
  const intervals: number[] = [];
  const catches = events.filter(e => e.kind === 'Catch');
  for (let i = 1; i < catches.length; i++) {
    const a = catches[i-1], b = catches[i];
    if (reviewed(a) && reviewed(b) && a.side !== b.side && b.t > a.t && !crossesBreak(p, a.t, b.t)) intervals.push(b.t-a.t);
  }
  const mean = (xs: number[]) => xs.length ? xs.reduce((a,b) => a+b,0)/xs.length : null;
  const interval = mean(intervals);
  return { pairs, incomplete, pending: events.filter(e => e.review === 'suggested').length,
    rate: interval !== null ? 60/interval : null, intervals: intervals.length,
    left: mean(pairs.filter(s => s.catch.side === 'Left').map(s => s.duration)),
    right: mean(pairs.filter(s => s.catch.side === 'Right').map(s => s.duration)),
    variation: interval !== null && intervals.length >= 3
      ? Math.sqrt(intervals.reduce((sum,x) => sum+(x-interval)**2,0)/intervals.length)/interval*100 : null };
}
