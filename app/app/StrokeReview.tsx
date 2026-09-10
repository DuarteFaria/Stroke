import { useMemo, useState } from 'react';
import type { EventMark, Project } from '@/lib/motion';
import { reviewed, strokeSummary } from '@/lib/strokes';

const label = (e: EventMark) => `${e.kind === 'Catch' ? 'Entrada' : 'Saída'} · ${e.side === 'Left' ? 'esquerda' : 'direita'}`;
const seconds = (n: number | null) => n === null ? '—' : `${n.toFixed(2)} s`;
type Props = { project: Project; time: number; disabled: boolean; hasVideo: boolean;
  commit: (p: Project) => void; seek: (t: number) => void; replay: (a: number, b: number) => void;
};

export default function StrokeReview({ project: p, time, disabled, hasVideo, commit, seek, replay }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [manualSide, setManualSide] = useState<'Left' | 'Right'>('Left');
  const events = p.events.filter(e => e.review !== 'skipped' && e.t >= p.segment[0] && e.t <= p.segment[1]).sort((a,b) => a.t-b.t);
  const active = events.find(e => e.id === selected);
  const unavailable = disabled || !hasVideo;
  const select = (e: EventMark, play = false) => {
    setSelected(e.id); setAdjusting(false);
    if (play) replay(Math.max(p.segment[0],e.t-.6), Math.min(p.segment[1],e.t+.6));
    else seek(e.t);
  };
  const patch = (e: EventMark, change: Partial<EventMark>) => commit({ ...p,
    events: p.events.map(x => x.id === e.id ? { ...x, ...change } : x).sort((a,b) => a.t-b.t) });
  const move = (t: number) => {
    if (!active) return;
    const next = Math.max(p.segment[0], Math.min(t, p.segment[1], p.video.duration - 1/p.video.fps));
    patch(active, {t: next, source: 'manual', review: 'suggested'}); seek(next);
  };
  const add = (kind: EventMark['kind']) => {
    const e: EventMark = { id: crypto.randomUUID(), t: time, side: manualSide, kind, source: 'manual', review: 'confirmed' };
    commit({ ...p, events: [...p.events, e].sort((a,b) => a.t-b.t) });
    setSelected(e.id); setAdjusting(false); seek(e.t);
  };
  return <div className="stroke-inline" aria-label="Marcações da pagaiada">
    {!!events.length && <div className="stroke-lanes" aria-label="Entradas e saídas na linha do tempo">
      {events.map(e => <button key={e.id} data-event-id={e.id}
        className={`stroke-marker ${e.kind === 'Catch' ? 'marker-entry' : 'marker-exit'}`}
        data-reviewed={reviewed(e)} aria-pressed={active?.id === e.id}
        style={{left:`${e.t / (p.video.duration || 1) * 100}%`}}
        disabled={unavailable} title={`${label(e)} · ${e.t.toFixed(2)} s · ${reviewed(e) ? 'confirmado' : 'sugestão'} — clicar para rever`}
        aria-label={`${label(e)} em ${e.t.toFixed(2)} segundos, ${reviewed(e) ? 'confirmado' : 'por rever'}`}
        onClick={() => select(e, true)}>{e.kind === 'Catch' ? '↓' : '↑'}{e.side === 'Left' ? 'E' : 'D'}</button>)}
    </div>}
    <div className="stroke-toolbar">
      <label className="sr-only" htmlFor="marker-side">Pá do atleta para novas marcações</label>
      <select id="marker-side" value={manualSide} disabled={unavailable} onChange={e => setManualSide(e.target.value as 'Left' | 'Right')}><option value="Left">Pá esquerda</option><option value="Right">Pá direita</option></select>
      {(['Catch','Exit'] as const).map(kind => <button key={kind} disabled={unavailable || time < p.segment[0] || time > p.segment[1]} onClick={() => add(kind)}>{kind === 'Catch' ? '+ Entrada' : '+ Saída'}</button>)}
    </div>
    {active && <div className="marker-edit" data-event-id={active.id}>
      <span className="marker-caption"><strong>{label(active)}</strong> <time>{active.t.toFixed(2)} s</time><small>{reviewed(active) ? 'Confirmado' : 'Por rever'}</small></span>
      {!adjusting ? <>
        <button disabled={unavailable} onClick={() => select(active,true)}>Rever</button>
        <button disabled={unavailable || reviewed(active)} onClick={() => { patch(active,{review:'confirmed'}); seek(active.t); }}>Confirmar</button>
        <button disabled={unavailable} onClick={() => { seek(active.t); setAdjusting(true); }}>Ajustar</button>
        <button disabled={unavailable} onClick={() => { patch(active,{review:'skipped'}); seek(active.t); }}>Remover</button>
      </> : <>
        <button disabled={unavailable || active.t <= p.segment[0]} title="Recuar a marcação um fotograma" onClick={() => move(active.t - 1/p.video.fps)}>−1 fotograma</button>
        <button disabled={unavailable || active.t >= Math.min(p.segment[1],p.video.duration-1/p.video.fps)} title="Avançar a marcação um fotograma" onClick={() => move(active.t + 1/p.video.fps)}>+1 fotograma</button>
        <button disabled={unavailable || time < p.segment[0] || time > p.segment[1]} onClick={() => move(time)}>Marcar aqui</button>
        <select aria-label="Lado da marcação" disabled={unavailable} value={active.side} onChange={e => patch(active,{side:e.target.value as EventMark['side'],source:'manual',review:'suggested'})}><option value="Left">Esquerda</option><option value="Right">Direita</option></select>
        <select aria-label="Tipo de marcação" disabled={unavailable} value={active.kind} onChange={e => patch(active,{kind:e.target.value as EventMark['kind'],source:'manual',review:'suggested'})}><option value="Catch">Entrada</option><option value="Exit">Saída</option></select>
        <button disabled={unavailable} onClick={() => { patch(active,{review:'confirmed'}); setAdjusting(false); }}>Concluir</button>
      </>}
      <button aria-label="Fechar edição da marcação" disabled={disabled} onClick={() => {setSelected(null);setAdjusting(false);seek(time);}}>×</button>
    </div>}

  </div>;
}

export function TimingSummary({project: p}: {project: Project}) {
  const summary = useMemo(() => strokeSummary(p), [p]);
  return <div id="timing-summary" className="timing-summary">
      <h2>Resumo</h2>
      <p>Apenas marcações confirmadas · {summary.pairs.length} {summary.pairs.length === 1 ? 'pagaiada completa' : 'pagaiadas completas'}</p>
      <dl><div><dt>Pagaiadas / min</dt><dd>{summary.rate === null ? '—' : summary.rate.toFixed(0)}</dd></div><div><dt>Esquerda na água</dt><dd>{seconds(summary.left)}</dd></div><div><dt>Direita na água</dt><dd>{seconds(summary.right)}</dd></div></dl>
    </div>;
}
