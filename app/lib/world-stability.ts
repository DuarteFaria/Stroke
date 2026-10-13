import type { Frame, WorldPoint } from './motion.ts';

export const SIDE_PAIRS = [[1,4],[2,5],[3,6],[7,8],[9,10],[11,12],[13,14],[15,16],[17,18],[19,20],[21,22],[23,24],[25,26],[27,28],[29,30],[31,32]];
export const ARM_BONES = [[11,13],[13,15],[12,14],[14,16]];
const distance = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

/** Require agreement of both torso pairs in image AND world space. Crossed
 * wrists alone are never evidence of an anatomical side swap. */
export function sideSwap(a: Frame, b: Frame): boolean {
  if (!a.points || !b.points || !a.worldPoints || !b.worldPoints) return false;
  return [[11,12],[23,24]].every(([l,r]) => {
    const aw=a.worldPoints!, bw=b.worldPoints!, ai=a.points!, bi=b.points!;
    if ([aw[l],aw[r],bw[l],bw[r],ai[l],ai[r],bi[l],bi[r]].some(p=>p.v<.7)) return false;
    const av=[aw[l].x-aw[r].x,aw[l].y-aw[r].y,aw[l].z-aw[r].z];
    const bv=[bw[l].x-bw[r].x,bw[l].y-bw[r].y,bw[l].z-bw[r].z];
    const ax=ai[l].x-ai[r].x, ay=ai[l].y-ai[r].y;
    const bx=bi[l].x-bi[r].x, by=bi[l].y-bi[r].y;
    const al=Math.hypot(...av), bl=Math.hypot(...bv), il=Math.hypot(ax,ay), jl=Math.hypot(bx,by);
    return al>.08 && bl>.08 && il>.025 && jl>.025 &&
      av.reduce((sum,v,i)=>sum+v*bv[i],0)<-.8*al*bl && ax*bx+ay*by<-.8*il*jl;
  });
}

/** Display-only correspondence; first reliable frame anchors anatomical identity.
 * Reset on cuts, occlusion and gaps; never sort joints by screen position. */
export function consistentWorld(frames: Frame[], transitions: [number,number][] = []): Frame[] {
  let previous: Frame | undefined;
  return frames.map(frame => {
    if (frame.transition || transitions.some(([a,b])=>frame.t>=a && frame.t<=b) || !frame.worldPoints || !frame.points) {
      previous=undefined;
      return {...frame,worldPoints:null};
    }
    const contiguous=previous && !frame.breakBefore && frame.t-previous.t>0 && frame.t-previous.t<=.1 &&
      !transitions.some(([a,b])=>previous!.t<=b && frame.t>=a);
    const crossedCut=previous && transitions.some(([a,b])=>previous!.t<=b && frame.t>=a);
    let result=crossedCut ? {...frame,breakBefore:true} : frame;
    if (contiguous && sideSwap(previous!,frame)) {
      const worldPoints=frame.worldPoints.slice(), points=frame.points.slice();
      for (const [l,r] of SIDE_PAIRS) {
        [worldPoints[l],worldPoints[r]]=[worldPoints[r],worldPoints[l]];
        [points[l],points[r]]=[points[r],points[l]];
      }
      result={...frame,worldPoints,points};
    }
    previous=result;
    return result;
  });
}

/** Preserve shoulder anchors and measured directions, with robust per-run arm
 * lengths. This is a display constraint, not a calibrated body measurement. */
export function constrainArms(points: WorldPoint[], lengths: (number | null)[]): WorldPoint[] {
  const result=points.map(p=>({...p}));
  ARM_BONES.forEach(([a,b],i)=>{
    const length=lengths[i], observed=distance(points[a],points[b]);
    if (length===null || observed<1e-6 || points[a].v<.35 || points[b].v<.35) return;
    for (const axis of ['x','y','z'] as const) result[b][axis]=result[a][axis]+(points[b][axis]-points[a][axis])*length/observed;
  });
  return result;
}

export function stabilizeArmLengths(frames: Frame[]): Frame[] {
  const result=frames.slice();
  let start=0;
  while (start<frames.length) {
    if (!frames[start].worldPoints) { start++; continue; }
    let end=start+1;
    while (end<frames.length && frames[end].worldPoints && !frames[end].breakBefore && frames[end].t-frames[end-1].t<=.25) end++;
    const lengths=ARM_BONES.map(([a,b])=>{
      const samples=frames.slice(start,end).flatMap(f=>{
        const ps=f.worldPoints!;
        const length=distance(ps[a],ps[b]);
        return ps[a].v>=.7 && ps[b].v>=.7 && length>.05 && length<1 ? [length] : [];
      }).sort((a,b)=>a-b);
      return samples.length>=3 ? samples[Math.floor(samples.length/2)] : null;
    });
    for (let i=start;i<end;i++) result[i]={...frames[i],worldPoints:constrainArms(frames[i].worldPoints!,lengths)};
    start=end;
  }
  return result;
}

export function interpolatedArmLengths(a: WorldPoint[], b: WorldPoint[], fraction: number) {
  return ARM_BONES.map(([i,j])=>distance(a[i],a[j])*(1-fraction)+distance(b[i],b[j])*fraction);
}
