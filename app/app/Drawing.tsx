'use client';
/**
 * Desenhar por cima do vídeo. Parado, o desenho fica preso a esse momento;
 * a reproduzir, a tinta é laser e apaga-se sozinha. Tudo o que é guardado
 * passa pelo `commit` do Studio, por isso Ctrl+Z anula desenhos como o resto.
 */
import { useEffect, useEffectEvent, useId, useImperativeHandle, useRef, useState } from 'react';
import {
  MousePointer2,
  PenLine,
  Highlighter,
  Slash,
  MoveUpRight,
  Square,
  Circle,
  Type,
  DraftingCompass,
  SeparatorVertical,
  Focus,
  Zap,
  Eraser,
  Brush,
  X,
  Copy,
  Trash2,
  BrushCleaning,
  ImageDown,
  PersonStanding,
} from 'lucide-react';
import { JOINTS, type Point, type Project } from '@/lib/motion';
import { desktop } from '@/lib/desktop';
import { editorKeysBlocked } from '@/lib/keys';
import {
  COLORS,
  FONT,
  MAX_TEXT,
  SNAPS,
  WIDTH,
  angleDeg,
  arrowHead,
  hitTest,
  isDark,
  nearestJoint,
  newId,
  radii,
  resolvePoints,
  round,
  simplify,
  smoothPath,
  snap45,
  textBox,
  translate,
  visibility,
  type Anchor,
  type Drawing,
  type DrawingKind,
  type Px,
} from '@/lib/drawings';

export type DrawTool = DrawingKind | 'select' | 'laser' | 'eraser';
type Size = 1 | 2 | 3;
type Look = { color: string; size: Size; dashed: boolean; whole: boolean };
type Tone = 'info' | 'ok' | 'warn' | 'busy';
type Ask = {
  run: () => void;
  title: string;
  body: string;
  action: string;
  offerSave: boolean;
  danger: boolean;
};
type LayerApi = { cancel: () => boolean };
const NONE: Drawing[] = [];
const NO_RANGES: [number, number][] = [];
const JOINT_IDS = Object.keys(JOINTS).map(Number);
const FAMILY = "Inter, 'Segoe UI', sans-serif";
/** Laser ink: full strength, then gone about two seconds after it was drawn. */
const LASER_HOLD = 1300,
  LASER_LIFE = 2000;
const TOOLS: { id: DrawTool; label: string; key: string; tip?: string; Icon: typeof Brush }[] = [
  { id: 'select', label: 'Selecionar', key: 'V', tip: 'arrasta para mover', Icon: MousePointer2 },
  { id: 'pen', label: 'Caneta', key: 'C', Icon: PenLine },
  { id: 'highlighter', label: 'Marcador', key: 'M', Icon: Highlighter },
  { id: 'line', label: 'Linha', key: 'L', tip: 'Shift: 45°', Icon: Slash },
  { id: 'arrow', label: 'Seta', key: 'S', tip: 'Shift: 45°', Icon: MoveUpRight },
  { id: 'rect', label: 'Retângulo', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Círculo', key: 'O', tip: 'do centro para fora', Icon: Circle },
  { id: 'text', label: 'Texto', key: 'T', Icon: Type },
  { id: 'angle', label: 'Ângulo', key: 'A', tip: 'três cliques, o do meio é o vértice', Icon: DraftingCompass },
  { id: 'plumb', label: 'Prumo', key: 'P', tip: 'vertical; arrasta para o lado para horizontal', Icon: SeparatorVertical },
  { id: 'spotlight', label: 'Foco', key: 'H', tip: 'escurece o resto', Icon: Focus },
  { id: 'laser', label: 'Laser', key: 'K', tip: 'desaparece sozinho', Icon: Zap },
  { id: 'eraser', label: 'Borracha', key: 'B', Icon: Eraser },
];
const KEYS: Record<string, DrawTool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
const SIZES: [Size, string][] = [
  [1, 'Fino'],
  [2, 'Médio'],
  [3, 'Grosso'],
];
const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]/gi, '_');
const clock = (t: number) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
let measurer: CanvasRenderingContext2D | null = null;
/** Width of a label in the same font the SVG draws it with. */
function measure(text: string, font: number) {
  if (typeof document === 'undefined') return text.length * font * 0.56;
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * font * 0.56;
  measurer.font = `600 ${font}px ${FAMILY}`;
  return measurer.measureText(text).width;
}

export function useDrawing(o: {
  project: Project;
  current: React.RefObject<Project>;
  commit: (p: Project) => void;
  time: number;
  playing: boolean;
  pose: Point[] | null;
  enabled: boolean;
  askConfirm: (c: Ask) => void;
  say: (text: string, tone?: Tone) => void;
}) {
  const [active, setActive] = useState(false),
    [picked, setPicked] = useState<DrawTool>('pen'),
    [style, setStyle] = useState<Look>({ color: COLORS[0][0], size: 2, dashed: false, whole: false }),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [hidePose, setHidePose] = useState(false),
    /** On a small stage the style controls fold into one button; this is that popover. */
    [styleOpen, setStyleOpen] = useState(false);
  const layerRef = useRef<LayerApi | null>(null);
  const drawings = o.project.drawings ?? NONE;
  const transitions = o.project.transitions ?? NO_RANGES;
  const on = active && o.enabled;
  const selected =
    (on && drawings.find((x) => x.id === selectedId && visibility(x, o.time, false, transitions) > 0)) || null;
  const look: Look = selected
    ? { color: selected.color, size: selected.size, dashed: !!selected.dashed, whole: !!selected.whole }
    : style;
  /** A reproduzir, qualquer ferramenta de traço vira laser: nada fica guardado. */
  const tool: DrawTool = o.playing && picked !== 'select' && picked !== 'eraser' ? 'laser' : picked;
  const here = drawings.filter((x) => !x.whole && visibility(x, o.time) > 0);
  const save = (next: Drawing[]) => o.commit({ ...o.current.current, drawings: next });
  function open(value: boolean) {
    if (!value) {
      layerRef.current?.cancel();
      setSelectedId(null);
    }
    setStyleOpen(false);
    setActive(value);
  }
  function pick(next: DrawTool) {
    layerRef.current?.cancel();
    setPicked(next);
    if (next !== 'select') setSelectedId(null);
  }
  function apply(patch: Partial<Look>) {
    setStyle((s) => ({ ...s, ...patch }));
    if (!selected) return;
    const next: Drawing = { ...selected };
    if (patch.color) next.color = patch.color;
    if (patch.size) next.size = patch.size;
    if (patch.dashed !== undefined) {
      if (patch.dashed) next.dashed = true;
      else delete next.dashed;
    }
    if (patch.whole !== undefined) {
      if (patch.whole) next.whole = true;
      else {
        delete next.whole;
        // "Este momento" means now: re-pin it where the coach is looking.
        next.t = Math.round(o.time * 1000) / 1000;
      }
    }
    save(drawings.map((x) => (x.id === selected.id ? next : x)));
  }
  function remove() {
    if (!selected) return;
    save(drawings.filter((x) => x.id !== selected.id));
    setSelectedId(null);
  }
  function duplicate() {
    if (!selected) return;
    const copy: Drawing = {
      ...translate(selected, 0.02, 0.02, resolvePoints(selected, o.pose)),
      id: newId(),
      t: selected.whole ? selected.t : Math.round(o.time * 1000) / 1000,
    };
    save([...drawings, copy]);
    setSelectedId(copy.id);
  }
  function clearMoment() {
    save(drawings.filter((x) => !here.includes(x)));
    setSelectedId(null);
  }
  function clearAll() {
    o.askConfirm({
      run: () => {
        save([]);
        setSelectedId(null);
      },
      title: 'Apagar todos os desenhos?',
      body: 'Apaga os desenhos do vídeo inteiro. Podes anular a seguir.',
      action: 'Apagar tudo',
      offerSave: false,
      danger: true,
    });
  }
  /** Devolve true quando a tecla era para o desenho. */
  const onKey = (e: KeyboardEvent): boolean => {
    if (!o.enabled || editorKeysBlocked(e)) return false;
    const mod = e.ctrlKey || e.metaKey,
      k = e.key.toLowerCase();
    if (!mod && !e.altKey && k === 'd') {
      e.preventDefault();
      open(!on);
      return true;
    }
    if (!on) return false;
    if (e.key === 'Escape') {
      if (styleOpen) {
        setStyleOpen(false);
        return true;
      }
      if (layerRef.current?.cancel()) return true;
      if (selected) setSelectedId(null);
      else open(false);
      return true;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      remove();
      return true;
    }
    if (mod && k === 'd') {
      e.preventDefault();
      duplicate();
      return true;
    }
    if (!mod && !e.altKey && KEYS[k]) {
      pick(KEYS[k]);
      return true;
    }
    return false;
  };
  /**
   * Its own listener, so the Studio's keyboard handler needs no changes.
   * It listens in the capture phase, before any page-level handler: a key the
   * drawing uses (D, tool letters, Delete, Ctrl+D, and Esc while drawing is
   * open) is marked defaultPrevented and stopped there, so an outer Esc (e.g.
   * leaving presentation mode) only fires once drawing is closed. Digits and
   * F are never bound; Ctrl+Z / Ctrl+Y go on to the project history.
   */
  const keyEvent = useEffectEvent((e: KeyboardEvent) => {
    if (!onKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  });
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keyEvent(e);
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, []);
  async function exportImage(from: Element) {
    const wrap = from.closest('.video-wrap');
    const video = wrap?.querySelector('video'),
      layer = wrap?.querySelector<SVGSVGElement>('svg.drawing-layer');
    if (!video || !layer) return;
    video.pause();
    try {
      const blob = await renderFrame(video, layer, hidePose ? null : wrap!.querySelector<SVGSVGElement>('svg.overlay'));
      const t = video.currentTime;
      const name = `${slug(o.project.name) || 'stroke'}_${clock(t).replace(':', 'm').replace('.', 's')}.png`;
      const bridge = desktop();
      if (bridge?.saveImage) {
        if (!(await bridge.saveImage(new Uint8Array(await blob.arrayBuffer()), name))) return;
      } else {
        const url = URL.createObjectURL(blob),
          a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      o.say('Imagem exportada.', 'ok');
    } catch (e) {
      o.say(e instanceof Error ? e.message : 'Não foi possível exportar a imagem.', 'warn');
    }
  }
  return {
    on,
    enabled: o.enabled,
    open,
    tool,
    picked,
    pick,
    look,
    apply,
    drawings,
    save,
    selected,
    select: setSelectedId,
    remove,
    duplicate,
    here,
    clearMoment,
    clearAll,
    hidePose,
    setHidePose,
    styleOpen,
    setStyleOpen,
    pose: o.pose,
    time: o.time,
    playing: o.playing,
    transitions,
    w: o.project.video.width,
    h: o.project.video.height,
    layerRef,
    onKey,
    exportImage,
  };
}
export type DrawingState = ReturnType<typeof useDrawing>;

/** Video frame + skeleton (if shown) + drawings, at the video's own resolution. */
async function renderFrame(video: HTMLVideoElement, layer: SVGSVGElement, overlay: SVGSVGElement | null) {
  const W = video.videoWidth,
    H = video.videoHeight;
  if (!W || !H) throw Error('O vídeo ainda não está pronto.');
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Não foi possível exportar a imagem.');
  ctx.drawImage(video, 0, 0, W, H);
  const shown = layer.getBoundingClientRect().width || W;
  for (const svg of [overlay, layer]) {
    if (!svg) continue;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.querySelectorAll('.drawing-ui').forEach((n) => n.remove());
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.setAttribute('width', String(W));
    copy.setAttribute('height', String(H));
    copy.removeAttribute('class');
    copy.removeAttribute('style');
    // Hairlines drawn "non-scaling" on screen keep their on-screen weight.
    const factor = W / shown;
    copy.querySelectorAll('[vector-effect="non-scaling-stroke"]').forEach((n) => {
      n.removeAttribute('vector-effect');
      const width = parseFloat(n.getAttribute('stroke-width') || '1');
      n.setAttribute('stroke-width', String(width * factor));
      const dash = n.getAttribute('stroke-dasharray');
      if (dash) n.setAttribute('stroke-dasharray', dash.split(/[\s,]+/).map((v) => Number(v) * factor).join(' '));
    });
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml;charset=utf-8' }),
    );
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, 0, 0, W, H);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw Error('Não foi possível exportar a imagem.');
  return blob;
}

type Gesture =
  | { kind: 'shape'; draft: Drawing; start: Px; moved: boolean }
  | { kind: 'move'; id: string; start: Px; from: Px[]; moved: boolean }
  | { kind: 'handle'; id: string; index: number; from: Px[] }
  | { kind: 'erase'; removed: Set<string>; last?: Px }
  | { kind: 'angle'; start: Px }
  | { kind: 'laser' };
type Editing = { id: string | null; x: number; y: number; value: string; size: Size; color: string };
type LaserStroke = { pts: { x: number; y: number; at: number }[]; live: boolean };

export function DrawingLayer({ d }: { d: DrawingState }) {
  const { w, h } = d;
  const svgRef = useRef<SVGSVGElement>(null),
    canvasRef = useRef<HTMLCanvasElement>(null),
    inputRef = useRef<HTMLInputElement>(null),
    gesture = useRef<Gesture | null>(null),
    editRef = useRef<Editing | null>(null),
    pending = useRef<Drawing[] | null>(null),
    laser = useRef<{ strokes: LaserStroke[]; cursor: Px | null; raf: number }>({
      strokes: [],
      cursor: null,
      raf: 0,
    });
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  /** Screen pixels per video pixel: keeps hairlines and text readable at any size. */
  const [scale, setScale] = useState(1),
    [draft, setDraft] = useState<Drawing | null>(null),
    [preview, setPreviewState] = useState<Drawing[] | null>(null),
    [angle, setAngle] = useState<Anchor[]>([]),
    [hover, setHover] = useState<{ p: Px; joint: number | null; alt: boolean; shift: boolean } | null>(null),
    [editing, setEditingState] = useState<Editing | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width) setScale(r.width / w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w]);
  useEffect(() => {
    const state = laser.current;
    return () => cancelAnimationFrame(state.raf);
  }, []);
  const editKey = editing ? `${editing.id}|${editing.x}|${editing.y}` : '';
  useEffect(() => {
    if (editKey) inputRef.current?.focus();
  }, [editKey]);
  /** Kept in a ref too, so pointer-up never saves a preview one render behind. */
  function setPreview(next: Drawing[] | null) {
    pending.current = next;
    setPreviewState(next);
  }
  function setEditing(next: Editing | null) {
    editRef.current = next;
    setEditingState(next);
  }
  function cancel() {
    let any = false;
    if (gesture.current && gesture.current.kind !== 'laser') any = true;
    gesture.current = null;
    if (editRef.current) any = true;
    if (angle.length) any = true;
    setEditing(null);
    setAngle([]);
    setDraft(null);
    setPreview(null);
    return any;
  }
  useImperativeHandle(d.layerRef, () => ({ cancel }));

  const px = (q: Px): Px => ({ x: q.x * w, y: q.y * h });
  const sw = (s: Size) => Math.max(w * WIDTH[s][0], WIDTH[s][1] / scale);
  const fontOf = (s: Size) => Math.max(w * FONT[s][0], FONT[s][1] / scale);
  const tol = 8 / scale;
  const list = preview ?? d.drawings;
  const tool = d.tool;
  function local(e: { clientX: number; clientY: number }): Px {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  }
  /** Snap to the nearest tracked joint unless Alt is held. */
  function anchorAt(p: Px, snap: boolean): Anchor {
    const j = snap ? nearestJoint(d.pose, p, JOINT_IDS, w, h, 16 / scale) : null;
    return j === null || !d.pose
      ? { x: round(p.x), y: round(p.y) }
      : { x: round(d.pose[j].x), y: round(d.pose[j].y), joint: j };
  }
  const grabs = (x: Drawing) => tol + (sw(x.size) / 2) * (x.kind === 'highlighter' ? 3.4 : 1);
  function hitAt(p: Px, opts: { edge?: boolean; only?: DrawingKind; skip?: Set<string> } = {}) {
    const P = px(p);
    // Spotlights sit under everything else, so they are tried last.
    for (const spots of [false, true])
      for (let i = list.length - 1; i >= 0; i--) {
        const x = list[i];
        if ((x.kind === 'spotlight') !== spots || (opts.only && x.kind !== opts.only) || opts.skip?.has(x.id)) continue;
        if (visibility(x, d.time, false, d.transitions) <= 0) continue;
        const pts = resolvePoints(x, d.pose).map(px);
        if (hitTest(x, pts, P, grabs(x), { font: fontOf(x.size), measure, edge: opts.edge })) return x;
      }
    return null;
  }
  function add(kind: DrawingKind, points: Anchor[], extra: Partial<Drawing> = {}) {
    const x: Drawing = {
      id: newId(),
      kind,
      t: Math.round(d.time * 1000) / 1000,
      color: d.look.color,
      size: d.look.size,
      points,
      ...extra,
    };
    if (d.look.whole) x.whole = true;
    if (d.look.dashed && kind !== 'highlighter' && kind !== 'text' && kind !== 'spotlight') x.dashed = true;
    d.save([...d.drawings, x]);
  }
  function finishText() {
    const e = editRef.current;
    if (!e) return;
    setEditing(null);
    const text = e.value.trim().slice(0, MAX_TEXT);
    if (e.id) {
      const old = d.drawings.find((x) => x.id === e.id);
      if (!old) return;
      if (!text) d.save(d.drawings.filter((x) => x.id !== e.id));
      else if (text !== old.text) d.save(d.drawings.map((x) => (x.id === e.id ? { ...x, text } : x)));
    } else if (text) add('text', [{ x: round(e.x), y: round(e.y) }], { text });
  }
  function editText(x: Drawing) {
    const at = resolvePoints(x, d.pose)[0];
    d.select(x.id);
    setEditing({ id: x.id, x: at.x, y: at.y, value: x.text || '', size: x.size, color: x.color });
  }

  // ---------------------------------------------------------------- laser
  function paintLaser() {
    const L = laser.current;
    L.raf = 0;
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect(),
      dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)),
      H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const now = performance.now();
    for (const s of L.strokes) s.pts = s.pts.filter((q) => now - q.at < LASER_LIFE);
    L.strokes = L.strokes.filter((s) => s.pts.length || s.live);
    const lw = Math.max(3, r.width * 0.0045) * dpr,
      ink = d.look.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [width, alpha, color] of [
      [lw * 3, 0.22, ink],
      [lw, 1, ink],
      [lw * 0.35, 0.85, '#ffffff'],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (const s of L.strokes)
        for (let i = 1; i < s.pts.length; i++) {
          const a = s.pts[i - 1],
            b = s.pts[i],
            age = now - b.at;
          ctx.globalAlpha = alpha * (age < LASER_HOLD ? 1 : Math.max(0, 1 - (age - LASER_HOLD) / (LASER_LIFE - LASER_HOLD)));
          ctx.beginPath();
          ctx.moveTo(a.x * W, a.y * H);
          ctx.lineTo(b.x * W, b.y * H);
          ctx.stroke();
        }
    }
    if (L.cursor) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(L.cursor.x * W, L.cursor.y * H, lw * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(L.cursor.x * W, L.cursor.y * H, lw * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (L.strokes.length || L.cursor) L.raf = requestAnimationFrame(paintLaser);
  }
  function kick() {
    if (!laser.current.raf) laser.current.raf = requestAnimationFrame(paintLaser);
  }

  // -------------------------------------------------------------- pointer
  function down(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 || !d.on) return;
    const p = local(e);
    if (d.styleOpen) d.setStyleOpen(false);
    finishText();
    if (tool === 'laser') {
      e.currentTarget.setPointerCapture(e.pointerId);
      laser.current.strokes.push({ pts: [{ ...p, at: performance.now() }], live: true });
      gesture.current = { kind: 'laser' };
      kick();
      return;
    }
    const video = e.currentTarget.closest('.video-wrap')?.querySelector('video');
    if (video && !video.paused) video.pause();
    const snap = !e.altKey;
    if (tool === 'select') {
      const sel = d.selected && list.find((x) => x.id === d.selected!.id);
      if (sel && !['pen', 'highlighter', 'text'].includes(sel.kind)) {
        const pts = resolvePoints(sel, d.pose);
        const index = pts.findIndex((q) => Math.hypot((q.x - p.x) * w, (q.y - p.y) * h) <= 10 / scale);
        if (index >= 0) {
          e.currentTarget.setPointerCapture(e.pointerId);
          gesture.current = { kind: 'handle', id: sel.id, index, from: pts };
          return;
        }
      }
      const hit = hitAt(p);
      d.select(hit?.id ?? null);
      if (hit) {
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = { kind: 'move', id: hit.id, start: p, from: resolvePoints(hit, d.pose), moved: false };
      }
      return;
    }
    if (tool === 'eraser') {
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'erase', removed: new Set() };
      erase(p);
      return;
    }
    if (tool === 'text') {
      const hit = hitAt(p, { only: 'text' });
      if (hit) editText(hit);
      else setEditing({ id: null, x: p.x, y: p.y, value: '', size: d.look.size, color: d.look.color });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === 'angle') {
      const next = [...angle, anchorAt(p, snap)];
      if (next.length === 3) {
        add('angle', next);
        setAngle([]);
      } else {
        setAngle(next);
        gesture.current = { kind: 'angle', start: p };
      }
      return;
    }
    const kind = tool as DrawingKind;
    const first = anchorAt(p, snap && SNAPS.includes(kind));
    const points =
      kind === 'pen' || kind === 'highlighter' || kind === 'plumb'
        ? [first]
        : [first, { x: round(p.x), y: round(p.y) }];
    const shape: Drawing = {
      id: 'draft',
      kind,
      t: d.time,
      color: d.look.color,
      size: d.look.size,
      points,
      ...(kind === 'plumb' ? { axis: e.shiftKey ? ('h' as const) : ('v' as const) } : {}),
      ...(d.look.dashed && kind !== 'highlighter' ? { dashed: true } : {}),
    };
    gesture.current = { kind: 'shape', draft: shape, start: p, moved: false };
    setDraft(shape);
  }
  function erase(p: Px) {
    const g = gesture.current;
    if (g?.kind !== 'erase') return;
    // Walk the gap since the last event so a quick swipe cannot skip a stroke.
    const from = g.last ?? p;
    const steps = Math.max(1, Math.ceil(Math.hypot((p.x - from.x) * w, (p.y - from.y) * h) / (tol * 0.8)));
    g.last = p;
    let changed = false;
    for (let i = 1; i <= steps; i++) {
      const q = { x: from.x + ((p.x - from.x) * i) / steps, y: from.y + ((p.y - from.y) * i) / steps };
      const hit = hitAt(q, { edge: true, skip: g.removed });
      if (hit) {
        g.removed.add(hit.id);
        changed = true;
      }
    }
    if (changed) setPreview(d.drawings.filter((x) => !g.removed.has(x.id)));
  }
  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (!d.on) return;
    const p = local(e);
    const snapping = !e.altKey && (SNAPS.includes(tool as DrawingKind) || gesture.current?.kind === 'handle');
    setHover({ p, joint: snapping ? nearestJoint(d.pose, p, JOINT_IDS, w, h, 16 / scale) : null, alt: e.altKey, shift: e.shiftKey });
    const L = laser.current;
    const g = gesture.current;
    if (tool === 'laser' || g?.kind === 'laser') {
      L.cursor = p;
      if (g?.kind === 'laser') {
        const stroke = L.strokes[L.strokes.length - 1];
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const ev of events.length ? events : [e.nativeEvent])
          stroke?.pts.push({ ...local(ev), at: performance.now() });
      }
      kick();
      return;
    }
    if (L.cursor) {
      L.cursor = null;
      kick();
    }
    if (!g) return;
    const far = (a: Px, b: Px) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h) > 4 / scale;
    if (g.kind === 'erase') return erase(p);
    if (g.kind === 'move') {
      if (!g.moved && !far(g.start, p)) return;
      g.moved = true;
      const dx = p.x - g.start.x,
        dy = p.y - g.start.y;
      setPreview(d.drawings.map((x) => (x.id === g.id ? translate(x, dx, dy, g.from) : x)));
      return;
    }
    if (g.kind === 'handle') {
      const orig = d.drawings.find((x) => x.id === g.id);
      if (!orig) return;
      const snapThis = !e.altKey && SNAPS.includes(orig.kind) && !((orig.kind === 'ellipse' || orig.kind === 'spotlight') && g.index > 0);
      const points = g.from.map((q, i) =>
        i === g.index ? anchorAt(p, snapThis) : orig.points[i].joint !== undefined ? orig.points[i] : { x: round(q.x), y: round(q.y) },
      );
      setPreview(d.drawings.map((x) => (x.id === g.id ? { ...x, points } : x)));
      return;
    }
    if (g.kind !== 'shape') return;
    const s = g.draft;
    if (!g.moved && far(g.start, p)) g.moved = true;
    let next: Drawing = s;
    if (s.kind === 'pen' || s.kind === 'highlighter') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      const pts = s.points.slice();
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const q = local(ev),
          last = pts[pts.length - 1];
        if (Math.hypot((q.x - last.x) * w, (q.y - last.y) * h) < 1.5 / scale) continue;
        // A little lag smooths the hand without drifting from the stroke.
        pts.push({ x: last.x + (q.x - last.x) * 0.6, y: last.y + (q.y - last.y) * 0.6 });
      }
      next = { ...s, points: pts };
    } else if (s.kind === 'plumb') {
      if (g.moved) {
        const dx = Math.abs(p.x - g.start.x) * w,
          dy = Math.abs(p.y - g.start.y) * h;
        next = { ...s, axis: dx > dy ? 'h' : 'v' };
      }
    } else {
      const a = s.points[0];
      let b: Anchor = { x: p.x, y: p.y };
      if (s.kind === 'line' || s.kind === 'arrow') {
        b = e.shiftKey ? snap45(a, p, w, h) : anchorAt(p, !e.altKey);
      } else if (e.shiftKey) {
        // Square / circle: equal size on screen, not in normalised units.
        const side = Math.max(Math.abs(p.x - a.x) * w, Math.abs(p.y - a.y) * h);
        b = { x: a.x + (Math.sign(p.x - a.x) || 1) * (side / w), y: a.y + (Math.sign(p.y - a.y) || 1) * (side / h) };
      }
      next = { ...s, points: [a, b.joint === undefined ? { x: round(b.x), y: round(b.y) } : b] };
    }
    g.draft = next;
    setDraft(next);
  }
  function up(e: React.PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const p = local(e);
    const far = (a: Px, b: Px, min = 5) => Math.hypot((a.x - b.x) * w, (a.y - b.y) * h) > min / scale;
    if (g.kind === 'laser') {
      const stroke = laser.current.strokes[laser.current.strokes.length - 1];
      if (stroke) stroke.live = false;
      kick();
      return;
    }
    if (g.kind === 'move' || g.kind === 'handle' || g.kind === 'erase') {
      if (pending.current && (g.kind !== 'move' || g.moved)) d.save(pending.current);
      setPreview(null);
      return;
    }
    if (g.kind === 'angle') {
      // Dragging from one point to the next counts as the next click.
      if (far(g.start, p, 8)) {
        const next = [...angle, anchorAt(p, !e.altKey)];
        if (next.length === 3) {
          add('angle', next);
          setAngle([]);
        } else setAngle(next);
      }
      return;
    }
    setDraft(null);
    const s = g.draft;
    const P = s.points.map(px);
    const extra: Partial<Drawing> = s.axis ? { axis: s.axis } : {};
    if (s.kind === 'pen' || s.kind === 'highlighter') {
      const simple = simplify(P, 0.6 / scale).map((q) => ({ x: round(q.x / w), y: round(q.y / h) }));
      add(s.kind, simple.slice(0, 4000));
      return;
    }
    if (s.kind === 'plumb') return add('plumb', s.points, extra);
    if (s.kind === 'spotlight' && !g.moved) {
      const c = s.points[0];
      return add('spotlight', [c, { x: round(c.x + 0.09), y: round(c.y + (0.09 * w) / h) }]);
    }
    if (!far(s.points[0], s.points[1])) return;
    add(s.kind, s.points, extra);
  }
  function cancelPointer() {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === 'laser') {
      const stroke = laser.current.strokes[laser.current.strokes.length - 1];
      if (stroke) stroke.live = false;
    }
    setDraft(null);
    setPreview(null);
  }
  function leave() {
    setHover(null);
    if (laser.current.cursor) {
      laser.current.cursor = null;
      kick();
    }
  }

  // ------------------------------------------------------------- painting
  function pill(text: string, at: Px, font: number, color: string, centre: boolean, key: string) {
    const width = measure(text, font),
      box = textBox(width, at, font);
    const x = centre ? at.x - box.width / 2 : box.x,
      y = centre ? at.y - box.height / 2 : box.y;
    // A solid tag in the drawing's colour reads on any water; the letters take
    // whichever of white or near-black contrasts with it.
    const n = parseInt(color.slice(1), 16),
      light = ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 150;
    return (
      <g key={key}>
        <rect x={x} y={y} width={box.width} height={box.height} rx={font * 0.28} fill={color}
          stroke={isDark(color) ? '#ffffff' : '#000000'} strokeOpacity={0.35} strokeWidth={1 / scale} />
        <text x={x + font * 0.35} y={y + font * 1.03} fill={light ? '#121212' : '#ffffff'} fontSize={font} fontWeight={600} fontFamily={FAMILY}>
          {text}
        </text>
      </g>
    );
  }
  function paint(x: Drawing, P: Px[], opacity: number, key: string) {
    const s = sw(x.size),
      dark = isDark(x.color);
    const halo = dark ? '#ffffff' : '#000000',
      haloAlpha = dark ? 0.5 : 0.45,
      haloW = s + 2 * Math.max(1.2 / scale, s * 0.22);
    const dash = x.dashed ? `${s * 2.6} ${s * 2.2}` : undefined;
    const cap = x.dashed ? ('butt' as const) : ('round' as const);
    const both = (draw: (ink: string, width: number, alpha: number, k: string) => React.ReactNode) => (
      <>
        {draw(halo, haloW, haloAlpha, 'h')}
        {draw(x.color, s, 1, 'c')}
      </>
    );
    let body: React.ReactNode = null;
    switch (x.kind) {
      case 'pen': {
        const path = smoothPath(P);
        body = both((ink, width, alpha, k) => (
          <path key={k} d={path} fill="none" stroke={ink} strokeOpacity={alpha} strokeWidth={width} strokeDasharray={dash} strokeLinecap={cap} strokeLinejoin="round" />
        ));
        break;
      }
      case 'highlighter':
        body = <path d={smoothPath(P)} fill="none" stroke={x.color} strokeOpacity={0.38} strokeWidth={s * 3.4} strokeLinecap="round" strokeLinejoin="round" />;
        break;
      case 'line':
        body = both((ink, width, alpha, k) => (
          <line key={k} x1={P[0].x} y1={P[0].y} x2={P[1].x} y2={P[1].y} stroke={ink} strokeOpacity={alpha} strokeWidth={width} strokeDasharray={dash} strokeLinecap={cap} />
        ));
        break;
      case 'arrow': {
        const head = arrowHead(P[0], P[1], s);
        const tri = head.points.map((q) => `${q.x},${q.y}`).join(' ');
        const shaft = (ink: string, width: number, alpha: number, k: string) => (
          <line key={k} x1={P[0].x} y1={P[0].y} x2={head.shaftEnd.x} y2={head.shaftEnd.y} stroke={ink} strokeOpacity={alpha} strokeWidth={width} strokeDasharray={dash} strokeLinecap={cap} />
        );
        body = (
          <>
            {shaft(halo, haloW, haloAlpha, 'h')}
            <polygon points={tri} fill={halo} fillOpacity={haloAlpha} stroke={halo} strokeOpacity={haloAlpha} strokeWidth={haloW - s} strokeLinejoin="round" />
            {shaft(x.color, s, 1, 'c')}
            <polygon points={tri} fill={x.color} />
          </>
        );
        break;
      }
      case 'rect': {
        const r = {
          x: Math.min(P[0].x, P[1].x),
          y: Math.min(P[0].y, P[1].y),
          width: Math.abs(P[1].x - P[0].x),
          height: Math.abs(P[1].y - P[0].y),
        };
        body = both((ink, width, alpha, k) => (
          <rect key={k} {...r} rx={s} fill="none" stroke={ink} strokeOpacity={alpha} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" />
        ));
        break;
      }
      case 'ellipse': {
        const [rx, ry] = radii(P[0], P[1]);
        body = both((ink, width, alpha, k) => (
          <ellipse key={k} cx={P[0].x} cy={P[0].y} rx={rx} ry={ry} fill="none" stroke={ink} strokeOpacity={alpha} strokeWidth={width} strokeDasharray={dash} />
        ));
        break;
      }
      case 'plumb': {
        const v = x.axis !== 'h';
        const ends = v ? { x1: P[0].x, x2: P[0].x, y1: 0, y2: h } : { x1: 0, x2: w, y1: P[0].y, y2: P[0].y };
        body = (
          <>
            {both((ink, width, alpha, k) => (
              <line key={k} {...ends} stroke={ink} strokeOpacity={alpha} strokeWidth={width} strokeDasharray={dash} strokeLinecap={cap} />
            ))}
            <circle cx={P[0].x} cy={P[0].y} r={s * 1.6} fill={x.color} stroke={halo} strokeOpacity={haloAlpha} strokeWidth={haloW - s} />
          </>
        );
        break;
      }
      case 'angle': {
        const [A, B, C] = P;
        const value = angleDeg(A, B, C, 1, 1);
        const a1 = Math.atan2(A.y - B.y, A.x - B.x),
          a2 = Math.atan2(C.y - B.y, C.x - B.x);
        let diff = a2 - a1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        const arms = Math.min(Math.hypot(A.x - B.x, A.y - B.y), Math.hypot(C.x - B.x, C.y - B.y));
        const r = Math.min(arms * 0.4, 44 / scale);
        const mid = a1 + diff / 2,
          font = fontOf(x.size);
        const arc =
          r > 3 / scale
            ? `M${B.x + r * Math.cos(a1)} ${B.y + r * Math.sin(a1)}A${r} ${r} 0 0 ${diff > 0 ? 1 : 0} ${B.x + r * Math.cos(a2)} ${B.y + r * Math.sin(a2)}`
            : '';
        const at = { x: B.x + (r + font * 1.1) * Math.cos(mid), y: B.y + (r + font * 1.1) * Math.sin(mid) };
        body = (
          <>
            {both((ink, width, alpha, k) => (
              <polyline key={k} points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`} fill="none" stroke={ink} strokeOpacity={alpha} strokeWidth={width} strokeDasharray={dash} strokeLinecap={cap} strokeLinejoin="round" />
            ))}
            {arc &&
              both((ink, width, alpha, k) => (
                <path key={`a${k}`} d={arc} fill="none" stroke={ink} strokeOpacity={alpha} strokeWidth={width * 0.7} />
              ))}
            {value !== null && pill(`${Math.round(value)}°`, at, font, x.color, true, 'l')}
          </>
        );
        break;
      }
      case 'text':
        body = pill(x.text || '', P[0], fontOf(x.size), x.color, false, 't');
        break;
    }
    return (
      <g key={key} opacity={opacity}>
        {body}
      </g>
    );
  }

  const shown = list
    .filter((x) => editing?.id !== x.id)
    .map((x) => ({ x, o: visibility(x, d.time, d.playing, d.transitions), P: resolvePoints(x, d.pose).map(px) }))
    .filter((s) => s.o > 0);
  if (draft && d.on) shown.push({ x: draft, o: 1, P: resolvePoints(draft, d.pose).map(px) });
  /** The angle being placed, finished with wherever the pointer is. */
  if (d.on && tool === 'angle' && angle.length && hover) {
    const end = anchorAt(hover.p, !hover.alt);
    const temp: Drawing = {
      id: 'angle-draft',
      kind: angle.length === 1 ? 'line' : 'angle',
      t: d.time,
      color: d.look.color,
      size: d.look.size,
      points: [...angle, end],
      ...(d.look.dashed ? { dashed: true } : {}),
    };
    shown.push({ x: temp, o: 1, P: resolvePoints(temp, d.pose).map(px) });
  }
  const spots = shown.filter((s) => s.x.kind === 'spotlight');
  const sel = d.on && d.selected ? shown.find((s) => s.x.id === d.selected!.id) : undefined;
  const marks = (() => {
    if (!sel) return null;
    const { x, P } = sel;
    let xs = P.map((q) => q.x),
      ys = P.map((q) => q.y);
    if (x.kind === 'ellipse' || x.kind === 'spotlight') {
      const [rx, ry] = radii(P[0], P[1]);
      xs = [P[0].x - rx, P[0].x + rx];
      ys = [P[0].y - ry, P[0].y + ry];
    } else if (x.kind === 'text') {
      const font = fontOf(x.size),
        box = textBox(measure(x.text || '', font), P[0], font);
      xs = [box.x, box.x + box.width];
      ys = [box.y, box.y + box.height];
    } else if (x.kind === 'plumb') {
      if (x.axis === 'h') xs = [0, w];
      else ys = [0, h];
    }
    const pad = 6 / scale;
    return {
      box: {
        x: Math.min(...xs) - pad,
        y: Math.min(...ys) - pad,
        width: Math.max(...xs) - Math.min(...xs) + pad * 2,
        height: Math.max(...ys) - Math.min(...ys) + pad * 2,
      },
      handles: ['pen', 'highlighter', 'text'].includes(x.kind) ? [] : P,
    };
  })();
  const hint =
    !d.on
      ? ''
      : d.playing && d.picked !== 'select' && d.picked !== 'eraser'
        ? 'A reproduzir: o traço desaparece sozinho'
        : tool === 'angle'
          ? ['Clica na primeira ponta', 'Clica no vértice', 'Clica na outra ponta'][angle.length]
          : tool === 'laser'
            ? 'Laser: desaparece sozinho'
            : tool === 'text' && !editing
              ? 'Clica onde queres escrever'
              : '';
  /**
   * Native listeners: clicks on the drawing surface must not steal focus (the
   * text box would lose it), and a double click with Selecionar edits a label.
   */
  const mouseEvent = useEffectEvent((e: MouseEvent) => {
    if (!d.on) return;
    if (e.type === 'mousedown') e.preventDefault();
    else if (tool === 'select') {
      const hit = hitAt(local(e), { only: 'text' });
      if (hit) editText(hit);
    }
  });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const fn = (e: MouseEvent) => mouseEvent(e);
    el.addEventListener('mousedown', fn);
    el.addEventListener('dblclick', fn);
    return () => {
      el.removeEventListener('mousedown', fn);
      el.removeEventListener('dblclick', fn);
    };
  }, []);
  const snapJoint = d.on && hover && hover.joint !== null && d.pose ? hover.joint : null;
  const ui = 1 / scale;
  return (
    <>
      <svg
        ref={svgRef}
        className="drawing-layer"
        data-on={d.on || undefined}
        data-tool={d.on ? tool : undefined}
        data-hide-pose={(d.on && d.hidePose) || undefined}
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancelPointer}
        onPointerLeave={leave}
        aria-label="Desenhos sobre o vídeo"
      >
        {spots.length > 0 && (
          <g opacity={Math.max(...spots.map((s) => s.o))}>
            <defs>
              <filter id={`${uid}soft`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation={w * 0.006} />
              </filter>
              <mask id={`${uid}spot`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
                <rect width={w} height={h} fill="#fff" />
                {spots.map((s, i) => {
                  const [rx, ry] = radii(s.P[0], s.P[1]);
                  return <ellipse key={i} cx={s.P[0].x} cy={s.P[0].y} rx={rx} ry={ry} fill="#000" filter={`url(#${uid}soft)`} />;
                })}
              </mask>
            </defs>
            <rect width={w} height={h} fill="#000" fillOpacity={0.6} mask={`url(#${uid}spot)`} />
          </g>
        )}
        {shown.map((s, i) => (s.x.kind === 'spotlight' ? null : paint(s.x, s.P, s.o, `${s.x.id}-${i}`)))}
        {d.on && (
          <g className="drawing-ui" pointerEvents="none">
            {shown.flatMap((s) =>
              s.x.points.map((q, i) =>
                q.joint !== undefined ? (
                  <circle key={`${s.x.id}-j${i}`} cx={s.P[i].x} cy={s.P[i].y} r={4.5 * ui} fill="none" stroke="#fff" strokeWidth={1.5 * ui} opacity={0.85 * s.o} />
                ) : null,
              ),
            )}
            {marks && (
              <>
                <rect {...marks.box} fill="none" stroke="#fff" strokeOpacity={0.75} strokeWidth={ui} strokeDasharray={`${4 * ui} ${3 * ui}`} />
                {marks.handles.map((q, i) => (
                  <circle key={i} cx={q.x} cy={q.y} r={5 * ui} fill="#fff" stroke="#0b0b09" strokeWidth={1.5 * ui} />
                ))}
              </>
            )}
            {snapJoint !== null && d.pose && (
              <>
                <circle cx={d.pose[snapJoint].x * w} cy={d.pose[snapJoint].y * h} r={10 * ui} fill="#ffffff22" stroke="#fff" strokeWidth={2 * ui} />
                {pill(JOINTS[snapJoint], { x: d.pose[snapJoint].x * w + 14 * ui, y: d.pose[snapJoint].y * h - 26 * ui }, 12 * ui, '#ffffff', false, 'joint')}
              </>
            )}
          </g>
        )}
      </svg>
      <canvas ref={canvasRef} className="drawing-laser" aria-hidden="true" />
      {d.on && editing && (
        <input
          ref={inputRef}
          className="drawing-text-input"
          style={{
            left: `${editing.x * 100}%`,
            top: `${editing.y * 100}%`,
            fontSize: `${fontOf(editing.size) * scale}px`,
            background: editing.color,
            color: editing.color === '#ffffff' ? '#121212' : '#ffffff',
          }}
          value={editing.value}
          maxLength={MAX_TEXT}
          placeholder="Escreve…"
          aria-label="Texto do desenho"
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finishText();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setEditing(null);
            }
          }}
          onBlur={finishText}
        />
      )}
      {hint && <div className="drawing-hint">{hint}</div>}
    </>
  );
}

/** Ferramentas a flutuar sobre o vídeo: ferramentas à esquerda, estilo em cima. */
export function DrawingToolbar({ d }: { d: DrawingState }) {
  if (!d.enabled) return null;
  const keep = (e: React.PointerEvent) => e.preventDefault();
  if (!d.on)
    return (
      <button className="drawing-toggle" title="Desenhar por cima do vídeo (D)" onClick={() => d.open(true)}>
        <Brush size={15} />
        Desenhar
      </button>
    );
  const look = d.look;
  return (
    <>
      <div className="drawing-rail" role="toolbar" aria-label="Ferramentas de desenho" onPointerDown={keep}>
        {TOOLS.map(({ id, label, key, tip, Icon }) => (
          <button
            key={id}
            aria-label={label}
            aria-pressed={d.picked === id}
            title={`${label} (${key})${tip ? ` · ${tip}` : ''}`}
            onClick={() => d.pick(id)}
          >
            <Icon size={17} />
          </button>
        ))}
        <hr />
        {d.pose && (
          <button
            aria-label="Esqueleto"
            aria-pressed={!d.hidePose}
            title={d.hidePose ? 'Mostrar o esqueleto' : 'Esconder o esqueleto'}
            onClick={() => d.setHidePose(!d.hidePose)}
          >
            <PersonStanding size={16} />
          </button>
        )}
        {d.selected ? (
          <>
            <button aria-label="Duplicar" title="Duplicar (Ctrl+D)" onClick={d.duplicate}>
              <Copy size={16} />
            </button>
            <button aria-label="Apagar" title="Apagar (Delete)" onClick={d.remove}>
              <Trash2 size={16} />
            </button>
          </>
        ) : (
          <>
            {d.here.length > 0 && (
              <button aria-label="Limpar este momento" title="Limpar este momento" onClick={d.clearMoment}>
                <BrushCleaning size={16} />
              </button>
            )}
            {d.drawings.length > 0 && (
              <button aria-label="Apagar tudo" title="Apagar todos os desenhos" onClick={d.clearAll}>
                <Trash2 size={16} />
              </button>
            )}
          </>
        )}
      </div>
      <div
        className="drawing-bar"
        role="toolbar"
        aria-label="Estilo e ações do desenho"
        data-open={d.styleOpen || undefined}
        onPointerDown={keep}
      >
        <button
          className="drawing-more"
          aria-label="Cor, espessura e duração"
          aria-expanded={d.styleOpen}
          title="Cor, espessura e duração"
          onClick={() => d.setStyleOpen(!d.styleOpen)}
        >
          <i className="drawing-more-swatch" style={{ background: look.color }} />
          <i className="drawing-more-width" style={{ height: look.size * 2 }} />
          <span>{look.whole ? 'Plano' : 'Momento'}</span>
        </button>
        <div className="drawing-style">
          <span className="drawing-group">
            {COLORS.map(([color, label]) => (
              <button
                key={color}
                className="drawing-swatch"
                aria-label={label}
                aria-pressed={look.color === color}
                title={label}
                onClick={() => d.apply({ color })}
              >
                <i style={{ background: color }} />
              </button>
            ))}
          </span>
          <span className="drawing-group">
            {SIZES.map(([size, label]) => (
              <button
                key={size}
                className="drawing-size"
                aria-label={label}
                aria-pressed={look.size === size}
                title={label}
                onClick={() => d.apply({ size })}
              >
                <i style={{ height: size * 2 }} />
              </button>
            ))}
            <button
              className="drawing-size"
              aria-label="Tracejado"
              aria-pressed={look.dashed}
              title="Tracejado"
              onClick={() => d.apply({ dashed: !look.dashed })}
            >
              <i className="dash" />
            </button>
          </span>
          <fieldset className="drawing-seg">
            <legend className="sr-only">Quando aparece</legend>
            <button
              aria-pressed={!look.whole}
              title="Aparece neste momento do vídeo e pouco depois"
              onClick={() => d.apply({ whole: false })}
            >
              Este momento
            </button>
            <button
              aria-pressed={look.whole}
              title="Fica visível até ao próximo corte de câmara ou transição"
              onClick={() => d.apply({ whole: true })}
            >
              Plano inteiro
            </button>
          </fieldset>
        </div>
        <button
          className="drawing-export"
          aria-label="Exportar imagem"
          title="Exportar imagem: este fotograma com os desenhos (PNG)"
          onClick={(e) => void d.exportImage(e.currentTarget)}
        >
          <ImageDown size={16} />
          Exportar imagem
        </button>
        <button aria-label="Fechar desenho" title="Fechar desenho (Esc)" onClick={() => d.open(false)}>
          <X size={16} />
        </button>
      </div>
    </>
  );
}

/** Desenhos presos a um momento, como marcas na barra do tempo. */
export function DrawingMarks({
  d,
  pct,
  seek,
}: {
  d: DrawingState;
  pct: (t: number) => number;
  seek: (t: number) => void;
}) {
  const times: number[] = [];
  for (const t of d.drawings
    .filter((x) => !x.whole)
    .map((x) => x.t)
    .sort((a, b) => a - b))
    if (!times.length || t - times[times.length - 1] > 0.05) times.push(t);
  return (
    <>
      {times.map((t) => (
        <button
          key={t}
          className="drawing-mark"
          tabIndex={-1}
          style={{ left: `${pct(t)}%` }}
          title={`Desenho em ${clock(t)}`}
          aria-label={`Ir para o desenho em ${clock(t)}`}
          disabled={!d.enabled}
          onClick={() => seek(t)}
        />
      ))}
    </>
  );
}
