'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Flag, X, ZoomIn, ZoomOut } from 'lucide-react';
import {
  JOINTS,
  clamp,
  type EventMark,
  type Key,
  type MotionFlag,
  type Project,
} from '@/lib/motion';
import { reviewed } from '@/lib/strokes';
import type { Drawing } from '@/lib/drawings';

export const fmt = (t: number) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const sideName = (s: EventMark['side']) => (s === 'Left' ? 'esquerda' : 'direita');
const eventName = (e: Pick<EventMark, 'kind' | 'side'>) =>
  `${e.kind === 'Catch' ? 'Entrada' : 'Saída'} · ${sideName(e.side)}`;
/**
 * As quatro marcações, pela ordem em que acontecem numa pagaiada: as teclas
 * 1–4 seguem esta ordem, e a seguinte à última marcada fica sugerida.
 */
export const MARKS: { key: string; side: EventMark['side']; kind: EventMark['kind'] }[] = [
  { key: '1', side: 'Left', kind: 'Catch' },
  { key: '2', side: 'Left', kind: 'Exit' },
  { key: '3', side: 'Right', kind: 'Catch' },
  { key: '4', side: 'Right', kind: 'Exit' },
];
/** Uma marca de tempo por cada passo que caiba sem se atropelar. */
function ticks(a: number, b: number) {
  const step =
    [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find(
      (s) => (b - a) / s <= 12,
    ) ?? 600;
  const out: number[] = [];
  for (let t = Math.ceil(a / step) * step; t <= b + 1e-6; t += step)
    out.push(Number(t.toFixed(3)));
  return { step, out };
}
const tickLabel = (t: number, step: number) =>
  step < 1
    ? t.toFixed(1)
    : `${Math.floor(t / 60)}:${Math.floor(t % 60)
        .toString()
        .padStart(2, '0')}`;

type Picked = { kind: 'event'; id: string } | { kind: 'transition'; index: number } | null;
export type EditMode = 'correct' | 'paddle' | 'target';
type Props = {
  project: Project;
  time: number;
  busy: boolean;
  hasVideo: boolean;
  tracked: boolean;
  flags: MotionFlag[];
  bands: [number, number][];
  transitionStart: number | null;
  /** Desenhos do telestrador; os presos a um momento aparecem na sua pista. */
  drawings?: Drawing[];
  /** O desenho está aberto e fica com as teclas de letras. */
  keysOff?: boolean;
  commit: (p: Project) => void;
  seek: (t: number) => void;
  replay: (a: number, b: number) => void;
  dragSegment: (edge: 'in' | 'out', t: number) => void;
  endSegmentEdit: () => void;
  markTransition: () => void;
  cancelTransition: () => void;
  onFlag: (f: MotionFlag) => void;
  onKey: (mode: EditMode, t: number) => void;
  /** Transporte e camadas: a linha de cima da doca, desenhada pelo Studio. */
  children: React.ReactNode;
};

/**
 * A doca do editor: um único eixo de tempo partilhado por todas as pistas, e
 * uma linha de ações para o que estiver escolhido ou para o fotograma atual.
 * O estado temporal (trecho, marcações, edições, avisos, transições) vê-se
 * aqui em vez de viver só em listas.
 */
export default function Timeline({
  project: p,
  time,
  busy,
  hasVideo,
  tracked,
  flags,
  bands,
  transitionStart,
  drawings,
  keysOff,
  commit,
  seek,
  replay,
  dragSegment,
  endSegmentEdit,
  markTransition,
  cancelTransition,
  onFlag,
  onKey,
  children,
}: Props) {
  const [picked, setPicked] = useState<Picked>(null);
  const [adjusting, setAdjusting] = useState(false);
  // A última marcação posta: fica escrita na linha em vez de abrir a marcação,
  // para se poderem pôr várias seguidas.
  const [placed, setPlaced] = useState<EventMark | null>(null);
  const [zoomPref, setZoomPref] = useState<boolean | null>(null);
  // Enquanto se arrasta uma pega o eixo fica parado, senão fugia ao rato.
  const [held, setHeld] = useState<{ edge: 'in' | 'out'; view: [number, number] } | null>(null);
  const scrubbing = useRef(false);
  const unavailable = busy || !hasVideo;
  const duration = Math.max(0.01, p.video.duration);
  const fps = p.video.fps;
  const [s0, s1] = p.segment;
  const segLength = s1 - s0;
  const inSegment = time >= s0 - 0.001 && time <= s1 + 0.001;

  // ------------------------------------------------------------------ axis
  const canZoom = tracked && segLength < duration * 0.85;
  const zoomed = canZoom && (zoomPref ?? true);
  const pad = segLength * 0.04;
  const view: [number, number] =
    held?.view ??
    (zoomed ? [Math.max(0, s0 - pad), Math.min(duration, s1 + pad)] : [0, duration]);
  const span = Math.max(0.01, view[1] - view[0]);
  const frac = (t: number) => (clamp(t, view[0], view[1]) - view[0]) / span;
  const at = (t: number) => `${frac(t) * 100}%`;
  const width = (a: number, b: number) => `${Math.max(0, frac(b) - frac(a)) * 100}%`;
  // Marcas fora do eixo aproximado escondem-se em vez de se colarem às pontas.
  const seen = (t: number) => t >= view[0] - 1e-6 && t <= view[1] + 1e-6;
  const spans = (a: number, b: number) => b >= view[0] && a <= view[1];
  const timeAt = (x: number, el: Element) => {
    const r = el.getBoundingClientRect();
    return view[0] + clamp((x - r.left) / r.width) * span;
  };
  const scale = ticks(view[0], view[1]);

  // ------------------------------------------------------------ scrubbing
  const track = {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (unavailable || e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button,[role="slider"]')) return;
      // Carregar no vazio larga a marcação escolhida; a ajustar, fica.
      if (!adjusting) setPicked(null);
      e.currentTarget.setPointerCapture(e.pointerId);
      scrubbing.current = true;
      seek(timeAt(e.clientX, e.currentTarget));
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      if (scrubbing.current) seek(timeAt(e.clientX, e.currentTarget));
    },
    onPointerUp() {
      scrubbing.current = false;
    },
    onPointerCancel() {
      scrubbing.current = false;
    },
  };
  /** Pega do trecho: arrastar, ou setas (Shift salta um segundo). */
  function grip(edge: 'in' | 'out') {
    const value = edge === 'in' ? s0 : s1;
    const set = (t: number) => {
      dragSegment(edge, t);
      seek(edge === 'in' ? Math.min(t, s1 - 0.1) : Math.max(t, s0 + 0.1));
    };
    return {
      role: 'slider',
      tabIndex: unavailable ? -1 : 0,
      'aria-label': edge === 'in' ? 'Início do trecho' : 'Fim do trecho',
      'aria-valuemin': 0,
      'aria-valuemax': Number(duration.toFixed(2)),
      'aria-valuenow': Number(value.toFixed(2)),
      'aria-valuetext': fmt(value),
      'aria-disabled': unavailable || undefined,
      title: `${edge === 'in' ? 'Início' : 'Fim'} do trecho · ${fmt(value)} — arrasta`,
      className: `seg-grip seg-${edge}`,
      style: { left: at(value) },
      onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
        if (unavailable || e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setHeld({ edge, view });
      },
      onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
        if (held?.edge !== edge) return;
        set(timeAt(e.clientX, e.currentTarget.parentElement!));
      },
      onPointerUp() {
        if (held?.edge !== edge) return;
        setHeld(null);
        endSegmentEdit();
      },
      onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        if (unavailable) return;
        const step = e.shiftKey ? 1 : 1 / fps;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          set(value + (e.key === 'ArrowLeft' ? -step : step));
        }
      },
      onKeyUp: endSegmentEdit,
      onBlur: endSegmentEdit,
    } as const;
  }

  // ------------------------------------------------------------ markers
  const events = p.events
    .filter((e) => e.review !== 'skipped' && e.t >= s0 && e.t <= s1)
    .sort((a, b) => a.t - b.t);
  const active =
    picked?.kind === 'event' ? events.find((e) => e.id === picked.id) : undefined;
  const pickedRange =
    picked?.kind === 'transition' ? p.transitions?.[picked.index] : undefined;
  const choose = (e: EventMark) => {
    setPicked({ kind: 'event', id: e.id });
    setPlaced(null);
    setAdjusting(false);
    replay(Math.max(s0, e.t - 0.6), Math.min(s1, e.t + 0.6));
  };
  const patch = (e: EventMark, change: Partial<EventMark>) =>
    commit({
      ...p,
      events: p.events
        .map((x) => (x.id === e.id ? { ...x, ...change } : x))
        .sort((a, b) => a.t - b.t),
    });
  const move = (t: number) => {
    if (!active) return;
    const next = Math.max(s0, Math.min(t, s1, p.video.duration - 1 / fps));
    patch(active, { t: next, source: 'manual', review: 'suggested' });
    seek(next);
  };
  /** A seguinte à última marcação antes do cursor, pela ordem de MARKS. */
  const prev = events.filter((e) => e.t <= time + 0.5 / fps).at(-1);
  const next = prev
    ? MARKS[(MARKS.findIndex((m) => m.side === prev.side && m.kind === prev.kind) + 1) % 4]
    : undefined;
  /**
   * Põe uma marcação e deixa a linha pronta para a seguinte: não abre a que
   * acabou de pôr. Carregar duas vezes no mesmo fotograma não a duplica.
   */
  const add = (side: EventMark['side'], kind: EventMark['kind']) => {
    const same = p.events.find(
      (x) =>
        x.review !== 'skipped' &&
        x.side === side &&
        x.kind === kind &&
        Math.abs(x.t - time) < 0.5 / fps,
    );
    if (same) {
      setPlaced(same);
      return;
    }
    const e: EventMark = {
      id: crypto.randomUUID(),
      t: time,
      side,
      kind,
      source: 'manual',
      review: 'confirmed',
    };
    commit({ ...p, events: [...p.events, e].sort((a, b) => a.t - b.t) });
    setPicked(null);
    setAdjusting(false);
    setPlaced(e);
  };
  const close = () => {
    setPicked(null);
    setAdjusting(false);
  };
  /** 1–4 marcam (pela ordem de MARKS); Esc fecha a marcação escolhida. */
  const keyboard = useEffectEvent((e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (el.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return;
    if (e.key === 'Escape') {
      close();
      return;
    }
    const mark = MARKS.find((m) => m.key === e.key);
    if (!mark || unavailable || !inSegment || adjusting || keysOff) return;
    e.preventDefault();
    add(mark.side, mark.kind);
  });
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keyboard(e);
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);
  /** Tempo na água: de cada entrada até à saída seguinte do mesmo lado. */
  const water = (list: EventMark[]) =>
    list.flatMap((e, i) =>
      e.kind === 'Catch' && list[i + 1]?.kind === 'Exit'
        ? [[e.t, list[i + 1].t] as [number, number]]
        : [],
    );

  // --------------------------------------------------------------- edits
  const editKeys = (
    [
      ['correct', p.corrections],
      ['target', p.target],
      ['paddle', p.paddle],
    ] as [EditMode, Key[]][]
  ).flatMap(([mode, keys]) => keys.map((k) => ({ mode, t: k.t })));
  const editName = { correct: 'Corpo', target: 'Ideal', paddle: 'Pagaia' };
  /** Vários pontos no mesmo fotograma mostram-se como um só aviso. */
  const flagGroups = flags.reduce<{ t: number; list: MotionFlag[] }[]>((out, f) => {
    const last = out[out.length - 1];
    if (last && f.t - last.t < 1.5 / fps) last.list.push(f);
    else out.push({ t: f.t, list: [f] });
    return out;
  }, []);
  const transitions = p.transitions || [];
  /** Desenhos presos a um momento; vários quase juntos contam como um. */
  const drawingTimes = (drawings ?? [])
    .filter((x) => !x.whole)
    .map((x) => x.t)
    .sort((a, b) => a - b)
    .reduce<number[]>((out, t) => (out.length && t - out[out.length - 1] <= 0.05 ? out : [...out, t]), []);
  const outside = !hasVideo || !inSegment;

  return (
    <section className="dock" aria-label="Linha do tempo">
      <div className="dock-head">{children}</div>
      <div className="dock-context" aria-live="polite">
        {active ? (
          <>
            <span className="ctx-title">
              <i className={`side-dot side-${active.side}`} />
              <strong>{eventName(active)}</strong>
              <time>{active.t.toFixed(2)} s</time>
              <small>{reviewed(active) ? 'Confirmada' : 'Por rever'}</small>
            </span>
            {!adjusting ? (
              <>
                <button disabled={unavailable} onClick={() => choose(active)}>
                  Rever
                </button>
                <button
                  disabled={unavailable || reviewed(active)}
                  onClick={() => {
                    patch(active, { review: 'confirmed' });
                    seek(active.t);
                    close();
                  }}
                >
                  Confirmar
                </button>
                <button
                  disabled={unavailable}
                  onClick={() => {
                    seek(active.t);
                    setAdjusting(true);
                  }}
                >
                  Ajustar
                </button>
                <button
                  disabled={unavailable}
                  onClick={() => {
                    patch(active, { review: 'skipped' });
                    seek(active.t);
                    close();
                  }}
                >
                  Remover
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={unavailable || active.t <= s0}
                  title="Recuar a marcação um fotograma"
                  onClick={() => move(active.t - 1 / fps)}
                >
                  −1 fotograma
                </button>
                <button
                  disabled={
                    unavailable ||
                    active.t >= Math.min(s1, p.video.duration - 1 / fps)
                  }
                  title="Avançar a marcação um fotograma"
                  onClick={() => move(active.t + 1 / fps)}
                >
                  +1 fotograma
                </button>
                <button disabled={unavailable || !inSegment} onClick={() => move(time)}>
                  Marcar aqui
                </button>
                <select
                  aria-label="Lado da marcação"
                  disabled={unavailable}
                  value={active.side}
                  onChange={(e) =>
                    patch(active, {
                      side: e.target.value as EventMark['side'],
                      source: 'manual',
                      review: 'suggested',
                    })
                  }
                >
                  <option value="Left">Esquerda</option>
                  <option value="Right">Direita</option>
                </select>
                <select
                  aria-label="Tipo de marcação"
                  disabled={unavailable}
                  value={active.kind}
                  onChange={(e) =>
                    patch(active, {
                      kind: e.target.value as EventMark['kind'],
                      source: 'manual',
                      review: 'suggested',
                    })
                  }
                >
                  <option value="Catch">Entrada</option>
                  <option value="Exit">Saída</option>
                </select>
                <button
                  disabled={unavailable}
                  onClick={() => {
                    patch(active, { review: 'confirmed' });
                    setAdjusting(false);
                  }}
                >
                  Concluir
                </button>
              </>
            )}
            <button
              className="ctx-close"
              aria-label="Fechar a marcação"
              title="Fechar (Esc, ou carrega fora)"
              onClick={close}
            >
              <X size={14} />
            </button>
          </>
        ) : pickedRange ? (
          <>
            <span className="ctx-title">
              <strong>Transição</strong>
              <time>
                {fmt(pickedRange[0])} – {fmt(pickedRange[1])}
              </time>
              <small>Não conta como remada</small>
            </span>
            <button disabled={unavailable} onClick={() => seek(pickedRange[0])}>
              Ir
            </button>
            <button
              disabled={busy}
              onClick={() => {
                commit({
                  ...p,
                  transitions: transitions.filter(
                    (_, j) => j !== (picked as { index: number }).index,
                  ),
                });
                close();
              }}
            >
              Remover
            </button>
            <button
              className="ctx-close"
              aria-label="Fechar a transição"
              title="Fechar"
              onClick={close}
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <>
            {(['Left', 'Right'] as const).map((s) => (
              <fieldset key={s} className={`mark-side side-${s}`}>
                <legend className="sr-only">Pá {sideName(s)}</legend>
                <i className="side-dot" />
                <span className="mark-name">{s === 'Left' ? 'Esq.' : 'Dir.'}</span>
                <span className="mark-pair">
                  {MARKS.filter((m) => m.side === s).map((m) => (
                    <button
                      key={m.key}
                      data-next={(next === m && !outside && !unavailable) || undefined}
                      disabled={unavailable || outside}
                      title={`${eventName(m)} neste fotograma (${m.key})`}
                      onClick={() => add(m.side, m.kind)}
                    >
                      {m.kind === 'Catch' ? 'Entrada' : 'Saída'}
                      <small>{m.key}</small>
                    </button>
                  ))}
                </span>
              </fieldset>
            ))}
            {placed && p.events.some((x) => x.id === placed.id && x.review !== 'skipped') && (
              <small className="ctx-why placed" key={placed.id}>
                <i className={`side-dot side-${placed.side}`} />
                {eventName(placed)} em {placed.t.toFixed(2)} s · Ctrl+Z anula
              </small>
            )}
            <span className="ctx-sep" />
            <button
              disabled={
                busy ||
                !hasVideo ||
                (transitionStart !== null && time <= transitionStart)
              }
              title="Trecho sem remar: viragem, pausa. Volta a analisar para aplicar."
              onClick={markTransition}
            >
              <Flag size={14} />
              {transitionStart === null
                ? 'Início de transição'
                : `Fim de transição (desde ${fmt(transitionStart)})`}
            </button>
            {transitionStart !== null && (
              <button disabled={busy} onClick={cancelTransition}>
                Cancelar
              </button>
            )}
            {hasVideo && !busy && !inSegment && (
              <small className="ctx-why">Fora do trecho</small>
            )}
          </>
        )}
      </div>
      <div className="lanes">
        <Lane
          name="Trecho"
          className="lane-ruler"
          note={
            <small className={segLength > 120 ? 'warn-text' : undefined}>
              {segLength.toFixed(1)} s
            </small>
          }
          tool={
            canZoom && (
              <button
                className="lane-tool"
                aria-pressed={zoomed}
                title={zoomed ? 'Ver o vídeo inteiro' : 'Aproximar ao trecho'}
                aria-label={zoomed ? 'Ver o vídeo inteiro' : 'Aproximar ao trecho'}
                onClick={() => setZoomPref(!zoomed)}
              >
                {zoomed ? <ZoomOut size={13} /> : <ZoomIn size={13} />}
              </button>
            )
          }
          track={track}
        >
          {scale.out.map((t) => (
            <span key={t} className="tick" style={{ left: at(t) }}>
              <span>{tickLabel(t, scale.step)}</span>
            </span>
          ))}
          <span className="seg-window" style={{ left: at(s0), width: width(s0, s1) }} />
          {bands.filter(([a, b]) => spans(a, b)).map(([a, b]) => (
            <span
              key={a}
              className="band"
              style={{ left: at(a), width: `max(2px, ${width(a, b)})` }}
            />
          ))}
          <div {...grip('in')} />
          <div {...grip('out')} />
        </Lane>
        {(['Left', 'Right'] as const).map((s) => {
          const list = events.filter((e) => e.side === s);
          return (
            <Lane
              key={s}
              name={s === 'Left' ? 'Esquerda' : 'Direita'}
              className={`lane-side side-${s}`}
              empty={!list.length}
              note={<small>{list.length || ''}</small>}
              track={track}
            >
              {water(list).filter(([a, b]) => spans(a, b)).map(([a, b]) => (
                <span
                  key={a}
                  className="water"
                  title={`Na água ${(b - a).toFixed(2)} s`}
                  style={{ left: at(a), width: width(a, b) }}
                />
              ))}
              {list.filter((e) => seen(e.t)).map((e) => (
                <button
                  key={e.id}
                  className={`marker marker-${e.kind === 'Catch' ? 'entry' : 'exit'}`}
                  data-reviewed={reviewed(e)}
                  aria-pressed={active?.id === e.id}
                  style={{ left: at(e.t) }}
                  disabled={unavailable}
                  title={`${eventName(e)} · ${e.t.toFixed(2)} s · ${reviewed(e) ? 'confirmada' : 'por rever'}`}
                  aria-label={`${eventName(e)} em ${e.t.toFixed(2)} segundos, ${reviewed(e) ? 'confirmada' : 'por rever'}`}
                  onClick={() => choose(e)}
                >
                  {e.kind === 'Catch' ? '↓' : '↑'}
                </button>
              ))}
            </Lane>
          );
        })}
        <Lane name="Edições" className="lane-edits" empty={!editKeys.length} note={<small>{editKeys.length}</small>} track={track}>
          {editKeys.filter((k) => seen(k.t)).map((k) => (
            <button
              key={`${k.mode}-${k.t}`}
              className={`key key-${k.mode}`}
              style={{ left: at(k.t) }}
              disabled={unavailable}
              title={`${editName[k.mode]} editado · ${fmt(k.t)}`}
              aria-label={`${editName[k.mode]} editado em ${fmt(k.t)}`}
              onClick={() => onKey(k.mode, k.t)}
            />
          ))}
        </Lane>
        <Lane name="Avisos" className="lane-flags" empty={!flags.length} note={<small>{flags.length}</small>} track={track}>
          {flagGroups.filter((g) => seen(g.t)).map((g) => {
            const what = g.list
              .map(
                (f) =>
                  `${JOINTS[f.joint]}: ${f.kind === 'swap' ? 'troca de lados?' : 'salto?'}`,
              )
              .join('\n');
            return (
              <button
                key={g.t}
                className="flag"
                style={{ left: at(g.t) }}
                disabled={busy || !hasVideo}
                title={`${fmt(g.t)}\n${what}`}
                aria-label={`Rever ${fmt(g.t)}: ${what}`}
                onClick={() => onFlag(g.list[0])}
              />
            );
          })}
        </Lane>
        <Lane name="Transições" className="lane-transitions" empty={!transitions.length && transitionStart === null} note={<small>{transitions.length || ''}</small>} track={track}>
          {transitions.map(([a, b], i) => !spans(a, b) ? null : (
            <button
              key={`${a}-${b}`}
              className="transition"
              aria-label={`Transição ${fmt(a)} – ${fmt(b)}`}
              aria-pressed={picked?.kind === 'transition' && picked.index === i}
              style={{ left: at(a), width: width(a, b) }}
              disabled={busy}
              title={`Transição ${fmt(a)} – ${fmt(b)}`}
              onClick={() => {
                setPicked({ kind: 'transition', index: i });
                setAdjusting(false);
                seek(a);
              }}
            />
          ))}
          {transitionStart !== null && (
            <span
              className="transition pending"
              style={{
                left: at(Math.min(transitionStart, time)),
                width: width(Math.min(transitionStart, time), Math.max(transitionStart, time)),
              }}
            />
          )}
        </Lane>
        <Lane name="Desenhos" className="lane-sketches" empty={!drawingTimes.length} note={<small>{drawingTimes.length}</small>} track={track}>
          {drawingTimes.filter(seen).map((t) => (
            <button
              key={t}
              className="sketch"
              style={{ left: at(t) }}
              disabled={unavailable}
              title={`Desenho em ${fmt(t)}`}
              aria-label={`Ir para o desenho em ${fmt(t)}`}
              onClick={() => seek(t)}
            />
          ))}
        </Lane>
        <div className="lanes-axis" aria-hidden="true">
          {(s0 > view[0] || s1 < view[1]) && (
            <>
              <span className="outside" style={{ left: 0, width: width(view[0], s0) }} />
              <span className="outside" style={{ left: at(s1), right: 0 }} />
            </>
          )}
          {hasVideo && <span className="playhead" style={{ left: at(time) }} />}
        </div>
      </div>
    </section>
  );
}

/** Uma pista: nome à esquerda, e o tempo partilhado à direita. */
function Lane({
  name,
  note,
  tool,
  empty,
  className = '',
  track,
  children,
}: {
  name: string;
  note?: React.ReactNode;
  tool?: React.ReactNode;
  /** Sem nada ainda: a pista fica, esbatida, para a doca não mudar de altura. */
  empty?: boolean;
  className?: string;
  track: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return (
    <div className={`lane ${className}`} data-empty={empty || undefined}>
      <div className="lane-label">
        <span>{name}</span>
        {note}
        {tool}
      </div>
      <div className="lane-track" {...track}>
        {children}
      </div>
    </div>
  );
}
