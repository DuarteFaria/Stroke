export type Point = { x: number; y: number; v: number };
export type Frame = { t: number; points: Point[] | null };
export type Key = { t: number; points: Record<string, Point> };
export type EventMark = {
  id: string;
  t: number;
  kind: 'Catch' | 'Exit';
  side: 'Left' | 'Right';
};
export type Project = {
  version: 1;
  name: string;
  video: {
    name: string;
    size: number;
    duration: number;
    width: number;
    height: number;
    fps: number;
  };
  segment: [number, number];
  frames: Frame[];
  corrections: Key[];
  target: Key[];
  paddle: Key[];
  targetPaddle: Key[];
  events: EventMark[];
  notes: string;
  targetEnabled: boolean;
};
export const JOINTS: Record<number, string> = {
  0: 'Nariz',
  11: 'Ombro esquerdo',
  12: 'Ombro direito',
  13: 'Cotovelo esquerdo',
  14: 'Cotovelo direito',
  15: 'Pulso esquerdo',
  16: 'Pulso direito',
  23: 'Anca esquerda',
  24: 'Anca direita',
  25: 'Joelho esquerdo',
  26: 'Joelho direito',
  27: 'Tornozelo esquerdo',
  28: 'Tornozelo direito',
};
export const BONES = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a: Point, b: Point, f: number): Point => ({
  x: a.x + (b.x - a.x) * f,
  y: a.y + (b.y - a.y) * f,
  v: Math.min(a.v, b.v),
});
export function poseAt(frames: Frame[], t: number): Point[] | null {
  if (!frames.length) return null;
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (frames[m].t < t) lo = m + 1;
    else hi = m;
  }
  const b = frames[lo],
    a = frames[lo - 1];
  if (b && Math.abs(b.t - t) < 0.001) return b.points;
  if (!a) return b && Math.abs(b.t - t) < 0.08 ? b.points : null;
  if (!b) return Math.abs(a.t - t) < 0.08 ? a.points : null;
  if (!a.points || !b.points || b.t - a.t > 0.25) return null;
  return a.points.map((p, i) => lerp(p, b.points![i], (t - a.t) / (b.t - a.t)));
}
export function keyAt(
  keys: Key[],
  t: number,
  hold = true,
): Record<string, Point> {
  const out: Record<string, Point> = {};
  const ids = new Set(keys.flatMap((k) => Object.keys(k.points)));
  for (const id of ids) {
    const ks = keys.filter((k) => k.points[id]);
    const b = ks.find((k) => k.t >= t);
    const a = [...ks].reverse().find((k) => k.t <= t);
    if (a && b)
      out[id] = lerp(
        a.points[id],
        b.points[id],
        a.t === b.t ? 0 : (t - a.t) / (b.t - a.t),
      );
    else if (hold) {
      const k = a || b;
      if (k) out[id] = k.points[id];
    } else {
      const k = a || b;
      if (k && Math.abs(k.t - t) < 0.04) out[id] = k.points[id];
    }
  }
  return out;
}
export function applyOffsets(
  pose: Point[] | null,
  keys: Key[],
  t: number,
): Point[] | null {
  if (!pose) return null;
  const offsets = keyAt(keys, t);
  return pose.map((p, i) =>
    offsets[i]
      ? {
          x: p.x + offsets[i].x,
          y: p.y + offsets[i].y,
          v: Math.max(p.v, offsets[i].v),
        }
      : p,
  );
}
export function upsert(keys: Key[], t: number, id: string, p: Point): Key[] {
  const found = keys.find((k) => Math.abs(k.t - t) < 0.001);
  return (
    found
      ? keys.map((k) =>
          k === found ? { ...k, points: { ...k.points, [id]: p } } : k,
        )
      : [...keys, { t, points: { [id]: p } }]
  ).sort((a, b) => a.t - b.t);
}
export function editCorrection(
  keys: Key[],
  t: number,
  id: string,
  p: Point,
  segment: [number, number],
): Key[] {
  let next = keys;
  // Local support: keep the original motion outside 0.2 seconds around an isolated correction.
  for (const anchor of [
    Math.max(segment[0], t - 0.2),
    Math.min(segment[1], t + 0.2),
  ]) {
    if (
      Math.abs(anchor - t) > 0.001 &&
      !keys.some((k) => k.points[id] && Math.abs(k.t - anchor) < 0.21)
    )
      next = upsert(next, anchor, id, { x: 0, y: 0, v: 0 });
  }
  return upsert(next, t, id, p);
}
export function angle(
  a: Point | undefined,
  b: Point | undefined,
  c: Point | undefined,
  w: number,
  h: number,
): number | null {
  if (!a || !b || !c || Math.min(a.v, b.v, c.v) < 0.5) return null;
  const u = [(a.x - b.x) * w, (a.y - b.y) * h],
    v = [(c.x - b.x) * w, (c.y - b.y) * h];
  const norm = Math.hypot(...u) * Math.hypot(...v);
  return norm < 1e-8
    ? null
    : (Math.acos(clamp((u[0] * v[0] + u[1] * v[1]) / norm, -1, 1)) * 180) /
        Math.PI;
}
export function paddleAngle(
  p: Record<string, Point>,
  w: number,
  h: number,
): number | null {
  if (!['a', 'b', 'r1', 'r2'].every((k) => p[k])) return null;
  const a = p.a,
    b = p.b,
    r = p.r1,
    s = p.r2;
  return angle(
    { x: b.x - a.x, y: b.y - a.y, v: 1 },
    { x: 0, y: 0, v: 1 },
    { x: s.x - r.x, y: s.y - r.y, v: 1 },
    w,
    h,
  );
}
export function emptyProject(): Project {
  return {
    version: 1,
    name: 'Sessão sem nome',
    video: { name: '', size: 0, duration: 0, width: 640, height: 360, fps: 30 },
    segment: [0, 20],
    frames: [],
    corrections: [],
    target: [],
    paddle: [],
    targetPaddle: [],
    events: [],
    notes: '',
    targetEnabled: false,
  };
}
export function parseProject(value: unknown): Project {
  const fail = () => {
    throw new Error('Isto não é um projeto Stroke v1 válido.');
  };
  if (!value || typeof value !== 'object') return fail();
  const p = value as Project;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const point = (x: Point) =>
    x &&
    num(x.x) &&
    num(x.y) &&
    num(x.v) &&
    Math.abs(x.x) <= 10 &&
    Math.abs(x.y) <= 10 &&
    x.v >= 0 &&
    x.v <= 1;
  if (
    p.version !== 1 ||
    typeof p.name !== 'string' ||
    typeof p.notes !== 'string' ||
    typeof p.targetEnabled !== 'boolean' ||
    !p.video ||
    typeof p.video.name !== 'string' ||
    !num(p.video.size) ||
    p.video.size < 0 ||
    ![p.video.duration, p.video.width, p.video.height, p.video.fps].every(
      (x) => num(x) && x > 0,
    )
  )
    return fail();
  if (
    !Array.isArray(p.segment) ||
    p.segment.length !== 2 ||
    !p.segment.every(num) ||
    p.segment[0] < 0 ||
    p.segment[1] <= p.segment[0] ||
    p.segment[1] > p.video.duration + 0.1
  )
    return fail();
  const validTime = (t: number) =>
    num(t) && t >= 0 && t <= p.video.duration + 0.1;
  if (
    !Array.isArray(p.frames) ||
    p.frames.length > 20000 ||
    p.frames.some(
      (f, i) =>
        !f ||
        !validTime(f.t) ||
        (i > 0 && f.t <= p.frames[i - 1].t) ||
        (f.points !== null &&
          (!Array.isArray(f.points) ||
            f.points.length !== 33 ||
            !f.points.every(point))),
    )
  )
    return fail();
  for (const name of [
    'corrections',
    'target',
    'paddle',
    'targetPaddle',
  ] as const) {
    if (!Array.isArray(p[name]) || p[name].length > 20000) return fail();
    for (const k of p[name]) {
      if (!k || !validTime(k.t) || !k.points || typeof k.points !== 'object')
        return fail();
      for (const [id, pt] of Object.entries(k.points)) {
        if (
          !point(pt) ||
          !(name.includes('addle')
            ? ['a', 'b', 'r1', 'r2'].includes(id)
            : Object.keys(JOINTS).includes(id))
        )
          return fail();
      }
    }
    p[name].sort((a, b) => a.t - b.t);
  }
  if (
    !Array.isArray(p.events) ||
    p.events.length > 10000 ||
    p.events.some(
      (e) =>
        !e ||
        typeof e.id !== 'string' ||
        !validTime(e.t) ||
        !['Catch', 'Exit'].includes(e.kind) ||
        !['Left', 'Right'].includes(e.side),
    )
  )
    return fail();
  return p;
}
