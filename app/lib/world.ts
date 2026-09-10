import type { Frame, WorldPoint } from './motion.ts';

export const UPPER_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24];
const median = (values: number[]) => values.toSorted((a,b) => a-b)[Math.floor(values.length / 2)];

/** Symmetric, short-window display filter. Raw frames and missing estimates stay intact. */
export function stabilizeWorld(frames: Frame[], transitions: [number, number][] = []): Frame[] {
  const blocked = (f: Frame) => f.transition || transitions.some(([a,b]) => f.t >= a && f.t <= b);
  return frames.map((frame, i) => {
    if (blocked(frame)) return {...frame, worldPoints: null};
    if (!frame.worldPoints || !frame.points) return frame;
    const neighbours = [frame];
    for (const direction of [-1, 1]) {
      for (let j = i + direction; j >= 0 && j < frames.length; j += direction) {
        const f = frames[j], previous = frames[j - direction];
        const boundary = direction < 0 ? previous : f;
        if (Math.abs(f.t - frame.t) > .085 || boundary.breakBefore || blocked(f) ||
          !f.worldPoints || !f.points || transitions.some(([a,b]) => Math.min(frame.t,f.t) <= b && Math.max(frame.t,f.t) >= a)) break;
        neighbours.push(f);
      }
    }
    return {...frame, worldPoints: frame.worldPoints.map((p, joint) => {
      // Do not turn a low-visibility observation into a confident reconstructed joint.
      if (p.v < .35) return {...p};
      const samples = neighbours.filter(f => f.worldPoints![joint].v >= .35);
      let weight = 0, x = 0, y = 0, z = 0;
      for (const f of samples) {
        const w = Math.exp(-.5 * ((f.t-frame.t)/.04)**2), q = f.worldPoints![joint];
        weight += w; x += q.x*w; y += q.y*w; z += q.z*w;
      }
      return {...p, x:x/weight, y:y/weight, z:z/weight};
    })};
  });
}

/** One fixed camera target and scale per clip; no frame-by-frame auto-zoom. */
export function worldViewBounds(frames: Frame[]) {
  const centres = frames.flatMap(f => f.worldPoints && !f.transition ? [f.worldPoints] : [])
    .map(ps => UPPER_JOINTS.map(j => ps[j]).filter(p => p.v >= .35))
    .filter(ps => ps.length >= 3)
    .map(ps => ({x:median(ps.map(p=>p.x)), y:median(ps.map(p=>p.y)), z:median(ps.map(p=>p.z))}));
  const centre = centres.length ? {x:median(centres.map(p=>p.x)), y:median(centres.map(p=>p.y)), z:median(centres.map(p=>p.z))} : {x:0,y:-.3,z:0};
  const radii = frames.flatMap(f => f.worldPoints && !f.transition ? UPPER_JOINTS.map(j=>f.worldPoints![j]).filter(p=>p.v>=.7).map(p=>Math.hypot(p.x-centre.x,p.y-centre.y,p.z-centre.z)) : []).toSorted((a,b)=>a-b);
  const radius = radii.length ? radii[Math.floor((radii.length-1)*.98)] : .7;
  return {centre, scale:130 / Math.max(.25,radius)};
}

/** No interpolation across missing estimates, cuts, or tracking restarts. */
export function worldPoseAt(frames: Frame[], t: number): WorldPoint[] | null {
  let lo = 0, hi = frames.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (frames[m].t < t) lo = m + 1; else hi = m;
  }
  const a = frames[lo - 1], b = frames[lo];
  const points = (f: Frame | undefined) => f && !f.transition && f.points ? f.worldPoints ?? null : null;
  if (b && Math.abs(b.t - t) < .001) return points(b);
  if (!a) return b && Math.abs(b.t - t) < .08 ? points(b) : null;
  if (!b) return Math.abs(a.t - t) < .08 ? points(a) : null;
  const pa = points(a), pb = points(b);
  if (!pa || !pb || b.breakBefore || b.t - a.t > .25) return null;
  const f = (t - a.t) / (b.t - a.t);
  return pa.map((p, i) => ({
    x: p.x + (pb[i].x - p.x) * f,
    y: p.y + (pb[i].y - p.y) * f,
    z: p.z + (pb[i].z - p.z) * f,
    v: Math.min(p.v, pb[i].v),
  }));
}

/** Orthographic camera; input y points down as in MediaPipe. */
export function projectWorld(p: WorldPoint, yaw: number, pitch: number, zoom = 1, view = {centre:{x:0,y:-.3,z:0},scale:150}) {
  const px = p.x-view.centre.x, pz = p.z-view.centre.z;
  const x = px * Math.cos(yaw) + pz * Math.sin(yaw);
  const z = -px * Math.sin(yaw) + pz * Math.cos(yaw);
  const y = p.y-view.centre.y;
  return {
    x: 160 + x * view.scale * zoom,
    y: 180 + (y * Math.cos(pitch) - z * Math.sin(pitch)) * view.scale * zoom,
    depth: y * Math.sin(pitch) + z * Math.cos(pitch),
  };
}
