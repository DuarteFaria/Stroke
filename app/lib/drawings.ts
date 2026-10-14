import { shotAt, type Point } from './motion.ts';
/**
 * Drawings over the video ("telestrator"). Coordinates are normalised 0–1 like
 * the skeleton. A point may remember the joint it was snapped to: while that
 * joint is tracked the point follows the athlete, otherwise it falls back to
 * where it was drawn.
 */
export type DrawingKind =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'angle'
  | 'plumb'
  | 'spotlight';
export type Anchor = { x: number; y: number; joint?: number };
export type Drawing = {
  id: string;
  kind: DrawingKind;
  /** The moment it belongs to, in seconds of video. */
  t: number;
  /** Shown for the whole clip instead of around `t`. */
  whole?: boolean;
  color: string;
  size: 1 | 2 | 3;
  dashed?: boolean;
  points: Anchor[];
  text?: string;
  /** Reference line: vertical (plumb) or horizontal (level). */
  axis?: 'v' | 'h';
};
export type Px = { x: number; y: number };
export const KINDS: DrawingKind[] = [
  'pen',
  'highlighter',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'angle',
  'plumb',
  'spotlight',
];
/** How many points each kind carries: [min, max]. */
export const POINT_COUNT: Record<DrawingKind, [number, number]> = {
  pen: [1, 4000],
  highlighter: [1, 4000],
  line: [2, 2],
  arrow: [2, 2],
  rect: [2, 2],
  ellipse: [2, 2],
  spotlight: [2, 2],
  angle: [3, 3],
  text: [1, 1],
  plumb: [1, 1],
};
/** Kinds whose points snap to tracked joints (ellipse and spotlight: centre only). */
export const SNAPS: DrawingKind[] = ['line', 'arrow', 'angle', 'plumb', 'ellipse', 'spotlight'];
export const MAX_DRAWINGS = 2000;
export const MAX_POINTS = 200000;
export const MAX_TEXT = 300;
/** Seconds of video a pinned drawing stays up after its moment. */
export const HOLD = 1.5;
/** While playing, the last part of the hold fades out. */
export const FADE = 0.35;
/** A frame of slack so stepping onto the exact frame always shows it. */
export const EARLY = 0.02;
/**
 * Saturated colour on the video already means data (limbs, ideal, paddle,
 * raw estimate). Drawings stay out of those hues: a strong red first, then
 * plain white and black, and a deep blue well away from the right arm's cyan.
 */
export const COLORS: [string, string][] = [
  ['#ff2e2e', 'Vermelho'],
  ['#ffffff', 'Branco'],
  ['#121212', 'Preto'],
  ['#2f54ff', 'Azul'],
];
/** Stroke width as a share of the video width, with a floor in screen pixels. */
export const WIDTH: Record<1 | 2 | 3, [number, number]> = {
  1: [0.0028, 1.5],
  2: [0.005, 2.5],
  3: [0.009, 4],
};
/** Text height as a share of the video width, with a floor in screen pixels. */
export const FONT: Record<1 | 2 | 3, [number, number]> = {
  1: [0.02, 12],
  2: [0.028, 14],
  3: [0.04, 18],
};
export const round = (v: number) => Math.round(v * 1e5) / 1e5;
export const isDark = (color: string) => {
  const n = parseInt(color.slice(1), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 60;
};
export function newId() {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
/**
 * 0 hidden, 1 fully shown. Only fades during playback, never on a paused frame.
 * A whole-clip drawing stays up for its shot: a camera cut or other transition
 * ends it, since the athlete is somewhere else in the next one.
 */
export function visibility(
  d: Drawing,
  time: number,
  playing = false,
  transitions: [number, number][] = [],
): number {
  if (d.whole) {
    const [a, b] = shotAt(d.t, transitions);
    return time >= a - EARLY && time <= b + EARLY ? 1 : 0;
  }
  const dt = time - d.t;
  if (dt < -EARLY || dt > HOLD) return 0;
  if (!playing || dt <= HOLD - FADE) return 1;
  return Math.max(0, Math.min(1, (HOLD - dt) / FADE));
}
const usable = (q: Point | undefined) =>
  !!q && Number.isFinite(q.x) && Number.isFinite(q.y) && q.v > 0;
/**
 * Where each point sits now. Joint-anchored points take the joint's live
 * position; free points move rigidly with the drawing's reference anchor (the
 * vertex for an angle, else the first anchored point), so an arrow whose head
 * sits on a wrist keeps its shape as the athlete moves. If no anchor is
 * tracked in this frame, everything stays where it was drawn.
 */
export function resolvePoints(d: Drawing, pose: Point[] | null | undefined): Px[] {
  const live = d.points.map((q) =>
    q.joint !== undefined && pose && usable(pose[q.joint]) ? pose[q.joint] : null,
  );
  const ref = d.kind === 'angle' && live[1] ? 1 : live.findIndex(Boolean);
  const dx = ref >= 0 ? live[ref]!.x - d.points[ref].x : 0,
    dy = ref >= 0 ? live[ref]!.y - d.points[ref].y : 0;
  return d.points.map((q, i) =>
    live[i] ? { x: live[i]!.x, y: live[i]!.y } : { x: q.x + dx, y: q.y + dy },
  );
}
/** Inner angle at b, in degrees, measured on the picture (w × h pixels). */
export function angleDeg(a: Px, b: Px, c: Px, w: number, h: number): number | null {
  const u = [(a.x - b.x) * w, (a.y - b.y) * h],
    v = [(c.x - b.x) * w, (c.y - b.y) * h];
  const norm = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  if (norm < 1e-9) return null;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / norm));
  return (Math.acos(cos) * 180) / Math.PI;
}
/** Shift: keep b at the same distance from a, on the nearest 45° direction. */
export function snap45(a: Px, b: Px, w: number, h: number): Px {
  const dx = (b.x - a.x) * w,
    dy = (b.y - a.y) * h;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { ...b };
  const step = Math.PI / 4,
    ang = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: a.x + (Math.cos(ang) * len) / w, y: a.y + (Math.sin(ang) * len) / h };
}
export function nearestJoint(
  pose: Point[] | null | undefined,
  p: Px,
  joints: number[],
  w: number,
  h: number,
  radius: number,
): number | null {
  if (!pose) return null;
  let best: number | null = null,
    bestD = radius;
  for (const j of joints) {
    const q = pose[j];
    if (!usable(q)) continue;
    const dist = Math.hypot((q.x - p.x) * w, (q.y - p.y) * h);
    if (dist <= bestD) {
      best = j;
      bestD = dist;
    }
  }
  return best;
}
/** Pixel distance from p to segment ab (all in pixels). */
export function segmentDistance(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const f = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - a.x - f * dx, p.y - a.y - f * dy);
}
/** Rough text width when nothing can measure it (tests, server). */
export const guessWidth = (text: string, font: number) => text.length * font * 0.56;
/** The pill behind a label whose top-left corner is `at`. */
export function textBox(width: number, at: Px, font: number) {
  return { x: at.x, y: at.y, width: width + font * 0.7, height: font * 1.4 };
}
/** Ellipse radii from centre and edge point, in pixels. Shift draws a circle. */
export function radii(c: Px, e: Px, circle = false): [number, number] {
  const rx = Math.abs(e.x - c.x),
    ry = Math.abs(e.y - c.y);
  return circle ? [Math.max(rx, ry), Math.max(rx, ry)] : [rx, ry];
}
/**
 * Does pixel p touch drawing d (points already resolved to pixels)? `tol` is
 * the grab distance in pixels. Outlines (rectangle, circle) are only grabbed
 * by their edge so whatever is drawn inside them stays reachable; a spotlight
 * is grabbed anywhere inside unless `edge` is set.
 */
export function hitTest(
  d: Drawing,
  pts: Px[],
  p: Px,
  tol: number,
  opts: { font?: number; measure?: (text: string, font: number) => number; edge?: boolean } = {},
): boolean {
  const near = (a: Px, b: Px) => segmentDistance(p, a, b) <= tol;
  switch (d.kind) {
    case 'pen':
    case 'highlighter': {
      if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= tol;
      for (let i = 1; i < pts.length; i++) if (near(pts[i - 1], pts[i])) return true;
      return false;
    }
    case 'line':
    case 'arrow':
      return near(pts[0], pts[1]);
    case 'angle':
      return near(pts[0], pts[1]) || near(pts[1], pts[2]);
    case 'plumb':
      return d.axis === 'h' ? Math.abs(p.y - pts[0].y) <= tol : Math.abs(p.x - pts[0].x) <= tol;
    case 'rect': {
      const [a, b] = pts,
        c = { x: a.x, y: b.y },
        e = { x: b.x, y: a.y };
      return near(a, c) || near(c, b) || near(b, e) || near(e, a);
    }
    case 'ellipse':
    case 'spotlight': {
      const [rx, ry] = radii(pts[0], pts[1]);
      const dx = p.x - pts[0].x,
        dy = p.y - pts[0].y;
      const r = Math.hypot(dx / Math.max(rx, 1e-6), dy / Math.max(ry, 1e-6));
      if (d.kind === 'spotlight' && !opts.edge) return r <= 1 + tol / Math.max(1e-6, Math.min(rx, ry));
      return Math.abs(r - 1) * Math.max(1e-6, Math.min(rx, ry)) <= tol;
    }
    case 'text': {
      const font = opts.font ?? 16,
        text = d.text || '';
      const b = textBox((opts.measure ?? guessWidth)(text, font), pts[0], font);
      return p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol;
    }
  }
  return false;
}
/** Ramer–Douglas–Peucker, in whatever units the points are in. */
export function simplify<T extends Px>(pts: T[], eps: number): T[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1,
      far = 0;
    for (let i = a + 1; i < b; i++) {
      const dist = segmentDistance(pts[i], pts[a], pts[b]);
      if (dist > far) {
        far = dist;
        worst = i;
      }
    }
    if (worst > 0 && far > eps) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
/** A smooth SVG path through freehand points (quadratic curves through midpoints). */
export function smoothPath(pts: Px[]): string {
  const f = (v: number) => v.toFixed(1);
  if (!pts.length) return '';
  if (pts.length === 1) return `M${f(pts[0].x)} ${f(pts[0].y)}l0.01 0`;
  if (pts.length === 2) return `M${f(pts[0].x)} ${f(pts[0].y)}L${f(pts[1].x)} ${f(pts[1].y)}`;
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    d += `Q${f(pts[i].x)} ${f(pts[i].y)} ${f(m.x)} ${f(m.y)}`;
  }
  const last = pts[pts.length - 1];
  return `${d}L${f(last.x)} ${f(last.y)}`;
}
/** Arrow head triangle at b (pixels) and where the shaft should stop. */
export function arrowHead(a: Px, b: Px, width: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const head = Math.min(len * 0.6, width * 4.2 + 6);
  const ux = (b.x - a.x) / len,
    uy = (b.y - a.y) / len;
  const base = { x: b.x - ux * head, y: b.y - uy * head };
  const half = head * 0.55;
  return {
    shaftEnd: { x: b.x - ux * head * 0.7, y: b.y - uy * head * 0.7 },
    points: [b, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }],
  };
}
/** Move a drawing; points it moves stop following their joint. */
export function translate(d: Drawing, dx: number, dy: number, from: Px[]): Drawing {
  return {
    ...d,
    points: from.map((q) => ({ x: round(q.x + dx), y: round(q.y + dy) })),
  };
}
/**
 * Validate the `drawings` array of a project file. Malformed entries reject
 * the file like the rest of parseProject; kinds from a newer Stroke are
 * skipped so the project still opens.
 */
export function parseDrawings(value: unknown, duration: number): Drawing[] {
  const fail = (): never => {
    throw new Error('Desenhos inválidos.');
  };
  if (!Array.isArray(value) || value.length > MAX_DRAWINGS) return fail();
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const out: Drawing[] = [];
  const ids = new Set<string>();
  let total = 0;
  for (const raw of value as unknown[]) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
    const d = raw as Record<string, unknown>;
    if (typeof d.kind !== 'string' || d.kind.length > 40) return fail();
    if (!KINDS.includes(d.kind as DrawingKind)) continue;
    const kind = d.kind as DrawingKind;
    if (typeof d.id !== 'string' || !d.id || d.id.length > 64 || ids.has(d.id)) return fail();
    ids.add(d.id);
    if (!num(d.t) || d.t < 0 || d.t > duration + 0.1) return fail();
    if (d.whole !== undefined && typeof d.whole !== 'boolean') return fail();
    if (d.dashed !== undefined && typeof d.dashed !== 'boolean') return fail();
    if (typeof d.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(d.color)) return fail();
    if (d.size !== 1 && d.size !== 2 && d.size !== 3) return fail();
    const [min, max] = POINT_COUNT[kind];
    if (!Array.isArray(d.points) || d.points.length < min || d.points.length > max) return fail();
    total += d.points.length;
    if (total > MAX_POINTS) return fail();
    const points: Anchor[] = [];
    for (const q of d.points as unknown[]) {
      if (!q || typeof q !== 'object') return fail();
      const a = q as Record<string, unknown>;
      if (!num(a.x) || !num(a.y) || Math.abs(a.x) > 4 || Math.abs(a.y) > 4) return fail();
      if (a.joint !== undefined && (!Number.isInteger(a.joint) || (a.joint as number) < 0 || (a.joint as number) > 32))
        return fail();
      points.push(a.joint === undefined ? { x: a.x, y: a.y } : { x: a.x, y: a.y, joint: a.joint as number });
    }
    const clean: Drawing = { id: d.id, kind, t: d.t, color: d.color, size: d.size, points };
    if (d.whole) clean.whole = true;
    if (d.dashed) clean.dashed = true;
    if (kind === 'text') {
      if (typeof d.text !== 'string' || !d.text.trim() || d.text.length > MAX_TEXT) return fail();
      clean.text = d.text;
    }
    if (kind === 'plumb') {
      if (d.axis !== 'v' && d.axis !== 'h') return fail();
      clean.axis = d.axis;
    }
    out.push(clean);
  }
  return out;
}
