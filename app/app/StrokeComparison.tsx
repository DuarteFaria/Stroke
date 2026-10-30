import { memo, useMemo } from 'react';
import { shotAt, type Project } from '@/lib/motion';
import { comparisonStats, comparisonStrokes, reviewed, strokeSummary, type ComparedStroke } from '@/lib/strokes';

const SIDES = [['Left', 'Esq.'], ['Right', 'Dir.']] as const;
const clock = (t: number) => `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
const seconds = (value: number | null) => value === null ? '—' : `${value.toFixed(2)} s`;
const metrics = [{key: 'water', label: 'Na água'}, {key: 'recovery', label: 'Recuperação'}, {key: 'cycle', label: 'Ciclo'}] as const;

/** Uma frase com a diferença entre lados, ou nada se faltar um lado. */
function verdict(left: number | null, right: number | null) {
  if (left === null || right === null) return null;
  const d = right - left;
  if (Math.abs(d) < 0.005) return 'Os dois lados ficam o mesmo tempo na água.';
  const pct = Math.round(Math.abs(d) / Math.max(left, right) * 100);
  return `A direita fica ${Math.abs(d).toFixed(2)} s ${d > 0 ? 'mais' : 'menos'} na água do que a esquerda (${pct}%).`;
}

/**
 * Os tempos numa só vista: a cadência em cima, e depois duas perguntas — um
 * lado é diferente do outro, e qual remada foge às restantes. Cada pagaiada é uma barra (água cheia, recuperação esbatida)
 * que se carrega para a rever no vídeo.
 */
export default memo(function StrokeComparison({project: p, disabled, replay}: {
  project: Project; disabled: boolean; replay: (a: number,b: number) => void;
}) {
  const strokes = useMemo(() => comparisonStrokes(p), [p]);
  const rate = useMemo(() => strokeSummary(p).rate, [p]);
  // Só com entradas já há cadência, mesmo antes de haver remadas para comparar.
  const cadence = <dl className="comparison-rate"><dt>Cadência</dt><dd>{rate === null ? '—' : `${rate.toFixed(0)} /min`}</dd></dl>;
  if (!strokes.length)
    return <section id="stroke-comparison" className="stroke-comparison" aria-label="Comparar remadas">
      {rate !== null && cadence}
      <p className="comparison-empty">
        {p.events.some((e) => e.review !== 'skipped' && !reviewed(e) && e.t >= p.segment[0] && e.t <= p.segment[1])
          ? 'Há marcações por confirmar. Escolhe cada uma e carrega em Confirmar para comparar as remadas.'
          : 'Marca a entrada e a saída da pagaia (teclas 1–4) para comparar as remadas.'}
      </p>
    </section>;
  const bySide = SIDES.map(([side]) => strokes.filter(s => s.side === side));
  const rows = metrics.map(m => ({...m, stats: bySide.map(list => comparisonStats(list.map(s => s[m.key])))}))
    .filter(r => r.stats.some(s => s.mean !== null));
  const water = rows.find(r => r.key === 'water')!.stats;
  const say = verdict(water[0].mean, water[1].mean);
  const scale = Math.max(...strokes.map(s => s.cycle ?? s.water));
  const anyRecovery = strokes.some(s => s.recovery !== null);
  const pct = (v: number) => `${v / scale * 100}%`;
  // Com cortes de câmara, as pagaiadas agrupam-se pelo plano onde começam.
  const shots = strokes.reduce<{ shot: [number, number]; list: ComparedStroke[] }[]>((out, s) => {
    const shot = shotAt(s.start, p.transitions, p.video.duration);
    const last = out[out.length - 1];
    if (last && last.shot[0] === shot[0]) last.list.push(s);
    else out.push({ shot, list: [s] });
    return out;
  }, []);
  const bar = (s: ComparedStroke) => <li key={s.id}>
    <button className={`side-${s.side}`} disabled={disabled} onClick={() => replay(s.start, s.end ?? s.exit)}
      title={`Rever a remada em ${s.start.toFixed(2)} s · na água ${seconds(s.water)}${s.recovery !== null ? ` · recuperação ${seconds(s.recovery)}` : ''}`}>
      <span className="bar-name"><i className="side-dot" />{SIDES.find(x => x[0] === s.side)![1]} {bySide[s.side === 'Left' ? 0 : 1].indexOf(s) + 1}</span>
      <span className="bar-track">
        <span className="bar-water" style={{width: pct(s.water)}} />
        {s.recovery !== null && <span className="bar-recovery" style={{width: pct(s.recovery)}} />}
      </span>
      <span className="bar-value">{seconds(s.water)}</span>
    </button>
  </li>;
  return <section id="stroke-comparison" className="stroke-comparison" aria-label="Comparar remadas">
    {cadence}
    {say && <p className="comparison-verdict">{say}</p>}
    <table className="comparison-table">
      <caption className="sr-only">Médias por lado</caption>
      <thead><tr><th scope="col"><span className="sr-only">Medida</span></th>{SIDES.map(([side, name]) => <th scope="col" key={side}><i className={`side-dot side-${side}`} />{name}</th>)}</tr></thead>
      <tbody>
        {rows.map(r => <tr key={r.key}><th scope="row">{r.label}</th>{r.stats.map((s, i) => <td key={i}>{seconds(s.mean)}</td>)}</tr>)}
        <tr className="comparison-count"><th scope="row">Remadas</th>{bySide.map((list, i) => <td key={i}>{list.length}</td>)}</tr>
      </tbody>
    </table>
    <h3 className="comparison-sub">Cada remada</h3>
    {shots.length < 2 ? <ol className="stroke-bars">{strokes.map(bar)}</ol> : shots.map(({shot: [a, b], list}, i) =>
      <section key={a} className="stroke-shot" aria-label={`Plano ${i + 1}`}>
        <h4>Plano {i + 1} <span>{clock(a)}–{clock(b)} · {list.length}</span></h4>
        <ol className="stroke-bars">{list.map(bar)}</ol>
      </section>)}
    <p className="comparison-note">
      {anyRecovery && <><i className="key-water" /> na água <i className="key-recovery" /> recuperação · </>}
      Carrega numa remada para a rever. Só contam marcações confirmadas.
    </p>
  </section>;
});
