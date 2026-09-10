import { useMemo, useState } from 'react';
import { type Project } from '@/lib/motion';
import { comparisonStats, comparisonStrokes, type ComparedStroke } from '@/lib/strokes';

const sideName = (side: ComparedStroke['side']) => side === 'Left' ? 'Esquerda' : 'Direita';
const seconds = (value: number | null) => value === null ? '—' : `${value.toFixed(2)} s`;
const signedSeconds = (value: number | null) => {
  if (value === null) return '—';
  const rounded = Math.round(value*100)/100;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)} s`;
};
const strokeName = (s: ComparedStroke) => `${sideName(s.side)} · ${s.start.toFixed(2)} s`;
const metrics = [{key: 'water', label: 'Na água'}, {key: 'recovery', label: 'Recuperação'}, {key: 'cycle', label: 'Ciclo completo'}] as const;
export default function StrokeComparison({project: p, disabled, replay}: {
  project: Project; disabled: boolean; replay: (a: number,b: number) => void;
}) {
  const [mode,setMode] = useState<'strokes' | 'sides'>('strokes');
  const [ids,setIds] = useState<[string,string]>(['','']);
  const [sideFilter,setSideFilter] = useState<'All' | 'Left' | 'Right'>('All');
  const strokes = useMemo(() => comparisonStrokes(p), [p]);
  const filtered = strokes.filter(s => sideFilter === 'All' || s.side === sideFilter);
  const a = filtered.find(s => s.id === ids[0]) ?? filtered[0];
  const b = filtered.find(s => s.id === ids[1] && s.id !== a?.id) ?? filtered.find(s => s.id !== a?.id);
  const chosen = [a,b];
  const groups = mode === 'strokes' ? chosen.map(s => s ? [s] : []) :
    [strokes.filter(s => s.side === 'Left'),strokes.filter(s => s.side === 'Right')];
  const labels = mode === 'strokes' ? ['A','B'] : ['Esquerda','Direita'];
  return <section id="stroke-comparison" className="stroke-comparison" aria-label="Comparações de pagaiadas">
    <div className="comparison-heading"><div><h2>Comparar pagaiadas</h2><p>{strokes.length} pares entrada/saída confirmados · {strokes.filter(s => s.end !== null).length} ciclos completos</p></div>
      <fieldset className="comparison-tabs"><legend className="sr-only">Tipo de comparação</legend><button aria-pressed={mode === 'strokes'} onClick={() => setMode('strokes')}>Pagaiada a pagaiada</button><button aria-pressed={mode === 'sides'} onClick={() => setMode('sides')}>Esquerda / direita</button></fieldset>
    </div>
    {!strokes.length ? <p className="comparison-empty">Adicione e confirme uma entrada e uma saída do mesmo lado na linha do tempo. Para comparar a duração do ciclo e a recuperação, marque também a próxima entrada desse lado e a entrada intermédia do lado oposto.</p> : <>
      {mode === 'strokes' ? <>
        <label className="comparison-filter">Mostrar <select value={sideFilter} onChange={e => setSideFilter(e.target.value as typeof sideFilter)}><option value="All">Ambos os lados</option><option value="Left">Só esquerda</option><option value="Right">Só direita</option></select></label>
        <div className="comparison-pickers">{chosen.map((s,index) => <div key={index}>
          <label>Pagaiada {labels[index]}<select aria-label={`Pagaiada ${labels[index]}`} value={s?.id ?? ''} disabled={!filtered.length} onChange={e => { const next: [string,string] = [a?.id ?? '',b?.id ?? '']; next[index] = e.target.value; setIds(next); }}>
            {!s && <option value="">Sem outra pagaiada</option>}{filtered.map(option => <option key={option.id} value={option.id} disabled={chosen[1-index]?.id === option.id}>{strokeName(option)}</option>)}</select></label>
          <div className="comparison-actions"><button disabled={disabled || !s} onClick={() => s && replay(s.start,s.end ?? s.exit)}>Rever {labels[index]}</button></div>
        </div>)}</div>
        {!b && <p>Escolha um filtro com pelo menos duas pagaiadas para comparar A e B.</p>}
      </> : <p>Médias de todas as pagaiadas válidas no segmento selecionado. O número de amostras é indicado em cada medida.</p>}
      <div className="comparison-table-wrap"><table className="comparison-table"><caption>{mode === 'strokes' ? 'Tempos das pagaiadas selecionadas' : 'Tempos médios por lado'}</caption><thead><tr><th scope="col">Medida</th>{labels.map(l => <th scope="col" key={l}>{l}</th>)}<th scope="col">{mode === 'strokes' ? 'B − A' : 'Direita − esquerda'}</th></tr></thead><tbody>
        {metrics.map(metric => {
          const stats = groups.map(group => comparisonStats(group.map(s => s[metric.key])));
          const difference = stats[0].mean === null || stats[1].mean === null ? null : stats[1].mean-stats[0].mean;
          return <tr key={metric.key}><th scope="row">{metric.label}</th>{stats.map((stat,i) => <td key={i}>{seconds(stat.mean)}{mode === 'sides' && <small>n = {stat.count}{stat.count > 1 && <><br />{seconds(stat.min)} – {seconds(stat.max)}</>}</small>}</td>)}<td>{signedSeconds(difference)}</td></tr>;
        })}
      </tbody></table></div>
      <p>Recuperação: saída → próxima entrada do mesmo lado. «—» indica dados incompletos. Ciclos com marcações por rever, entradas em falta ou cortes são excluídos.</p>
    </>}
  </section>;
}
