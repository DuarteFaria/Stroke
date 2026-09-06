import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  poseAt,
  motionFlags,
  cautiousLegs,
  regionAt,
  keyAt,
  upsert,
  applyOffsets,
  editCorrection,
  angle,
  paddleAngle,
  emptyProject,
  parseProject,
} from '../lib/motion.ts';
const pt = (x = 0, y = 0, v = 1) => ({ x, y, v });
const pose = (x = 0) => Array.from({ length: 33 }, () => pt(x));

test('diagonal1 consecutive wrist error includes the missed 1.133s frame', () => {
  const p=JSON.parse(readFileSync(new URL('../../docs/benchmarks/baseline-v1/diagonal1.stroke.json',import.meta.url),'utf8'));
  const flags=motionFlags(p.frames,p.video.width,p.video.height);
  for (const t of [1,32/30,34/30]) assert.ok(flags.some(f=>f.joint===15 && Math.abs(f.t-t)<.001));
  const boundary=p.frames.map(f=>({...f,breakBefore:Math.abs(f.t-34/30)<.001}));
  assert.ok(!motionFlags(boundary,p.video.width,p.video.height).some(f=>Math.abs(f.t-34/30)<.001));
});
test('uncertain or jumping legs suppress measured angles without altering raw joints', () => {
  const points=pose(); points.forEach(p=>p.v=.95);points[27].v=.6;
  const original=JSON.stringify(points);
  const reviewed=cautiousLegs(points,[{t:1,joint:26,kind:'jump',score:1}],1);
  assert.equal(angle(reviewed[23],reviewed[25],reviewed[27],1920,1080),null);
  assert.equal(reviewed[26].v,.49);
  assert.equal(reviewed[15].v,.95);
  assert.equal(JSON.stringify(points),original);
  assert.equal(cautiousLegs(points,[],2)[26].v,.95);
  assert.equal(cautiousLegs(null,[],0),null);
});
test('motion review flags spikes and swaps without flagging steady fast motion or altering raw data', () => {
  const body=() => {
    const p=pose();
    for (const [j,x,y] of [[11,.3,.2],[12,.7,.2],[13,.3,.4],[14,.7,.4],[15,.3,.6],[16,.7,.6]]) p[j]={x,y,v:.9};
    return p;
  };
  const frames=[0,.067,.134].map(t=>({t,points:body()}));
  frames[1].points[15].x=.6;
  const original=JSON.stringify(frames);
  assert.ok(motionFlags(frames,1000,1000).some(f=>f.joint===15 && f.kind==='jump'));
  assert.equal(JSON.stringify(frames),original);
  frames[1].points=body();
  [frames[1].points[15],frames[1].points[16]]=[frames[1].points[16],frames[1].points[15]];
  assert.equal(motionFlags(frames,1000,1000).filter(f=>f.kind==='swap').length,2);
  frames[1].breakBefore=true;
  assert.deepEqual(motionFlags(frames,1000,1000),[]);
  delete frames[1].breakBefore;
  frames.forEach((f,i)=>{f.points=body();f.points[15].x=.1+i*.3;});
  assert.deepEqual(motionFlags(frames,1000,1000),[]);
  frames[1].points=null;
  assert.deepEqual(motionFlags(frames,1000,1000),[]);
});
test('transitions survive saving and prevent interpolation over a restart', () => {
  const p=emptyProject();p.video.duration=20;p.transitions=[[1,2]];
  p.frames=[{t:0,points:pose()},{t:.1,points:pose(),breakBefore:true}];
  assert.equal(poseAt(p.frames,.05),null);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))).transitions,[[1,2]]);
  assert.throws(() => parseProject({...p,transitions:[[2,1]]}));
  assert.throws(() => parseProject({...p,transitions:[[1,3],[2,4]]}));
});
test('analysis quality roundtrips per frame and invalid values are rejected', () => {
  const p = emptyProject(); p.video.duration = 20;
  p.analysisQuality = 'detailed'; p.frames = [{t:0,points:pose(),quality:'detailed'}];
  assert.equal(parseProject(JSON.parse(JSON.stringify(p))).frames[0].quality,'detailed');
  assert.throws(() => parseProject({...p,analysisQuality:'magic'}));
  assert.throws(() => parseProject({...p,frames:[{t:0,points:null,quality:'magic'}]}));
});
test('follow regions roundtrip and playback never borrows future or stale regions', () => {
  const p = emptyProject(); p.video.duration = 20;
  p.followAthlete = true;
  const region = {x:.2,y:.1,width:.4,height:.6};
  p.frames = [{t:1,points:pose(),region,regionStatus:'uncertain'}, {t:2,points:pose()}];
  const loaded = parseProject(JSON.parse(JSON.stringify(p)));
  assert.equal(loaded.followAthlete, true);
  assert.deepEqual(regionAt(loaded.frames,1.1)?.region,region);
  assert.equal(regionAt(loaded.frames,.9),undefined);
  assert.equal(regionAt(loaded.frames,1.5),undefined);
  assert.equal(regionAt(loaded.frames,2),undefined);
  assert.throws(() => parseProject({...p,followAthlete:'yes'}));
  assert.throws(() => parseProject({...p,frames:[{t:1,points:null,region:{...region,width:2}}]}));
});
test('athlete region is optional, preserved and validated', () => {
  const p = emptyProject();
  p.video.duration = 20;
  assert.equal(parseProject(p).athleteRegion, undefined);
  p.athleteRegion = {x: 0.2, y: 0.1, width: 0.4, height: 0.6};
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))).athleteRegion, p.athleteRegion);
  for (const region of [null, {x: 0, y: 0, width: 0.01, height: 1},
    {x: 0.8, y: 0, width: 0.5, height: 1}, {x: '0', y: 0, width: 1, height: 1}]) {
    assert.throws(() => parseProject({...p, athleteRegion: region}));
  }
});
test('pose interpolation uses timestamps and does not invent missing poses', () => {
  const frames = [
    { t: 1, points: pose(0) },
    { t: 1.1, points: pose(1) },
    { t: 1.2, points: null },
    { t: 2, points: pose(3) },
  ];
  assert.ok(Math.abs(poseAt(frames, 1.05)[15].x - 0.5) < 1e-8);
  assert.equal(poseAt(frames, 1.15), null);
  assert.equal(poseAt(frames, 1.5), null);
  assert.equal(poseAt(frames, 0), null);
});
test('angles account for video aspect ratio and reject uncertain/degenerate joints', () => {
  const a = angle(pt(1, 0), pt(), pt(1, 1), 1920, 1080);
  assert.ok(Math.abs(a - (Math.atan2(1080, 1920) * 180) / Math.PI) < 1e-8);
  assert.equal(angle(pt(1, 0, 0.2), pt(), pt(0, 1), 640, 360), null);
  assert.equal(angle(pt(), pt(), pt(0, 1), 640, 360), null);
  assert.equal(
    paddleAngle({ a: pt(), b: pt(0, 1), r1: pt(), r2: pt(1, 0) }, 640, 360),
    90,
  );
});
test('a correction is local, exact at its key and never mutates raw tracking', () => {
  const raw = pose(0.4);
  const snapshot = JSON.stringify(raw);
  const keys = editCorrection([], 1, '15', pt(0.1, 0.2), [0, 2]);
  assert.equal(applyOffsets(raw, keys, 1)[15].x, 0.5);
  assert.equal(applyOffsets(raw, keys, 0)[15].x, 0.4);
  assert.equal(applyOffsets(raw, keys, 2)[15].x, 0.4);
  assert.equal(applyOffsets(raw, keys, 1.2)[15].v, 1);
  assert.equal(JSON.stringify(raw), snapshot);
});
test('target offsets preserve baseline motion and interpolate separate from corrections', () => {
  let keys = upsert([], 1, '15', pt(0.1, 0.2));
  keys = upsert(keys, 2, '15', pt(0.3, 0.4));
  assert.ok(Math.abs(applyOffsets(pose(0.4), keys, 1.5)[15].x - 0.6) < 1e-8);
  assert.ok(Math.abs(applyOffsets(pose(0.5), keys, 1.5)[15].x - 0.7) < 1e-8);
  assert.equal(keyAt(keys, 0)['15'].x, 0.1);
});
test('paddle positions do not extrapolate outside annotated interval', () => {
  const keys = upsert(upsert([], 1, 'a', pt(0.1)), 2, 'a', pt(0.3));
  assert.deepEqual(keyAt(keys, 0, false), {});
  assert.deepEqual(keyAt(keys, 3, false), {});
  assert.ok(Math.abs(keyAt(keys, 1.5, false).a.x - 0.2) < 1e-8);
});
test('project JSON roundtrip preserves edits and validates untrusted input', () => {
  const p = emptyProject();
  p.video = {
    name: 'video.mp4',
    size: 200,
    duration: 4,
    width: 640,
    height: 360,
    fps: 29.97,
  };
  p.segment = [1, 3];
  p.frames = [{ t: 1, points: pose() }];
  p.corrections = upsert([], 1, '15', pt(0.1));
  p.target = upsert([], 1, '15', pt(0.2));
  p.targetEnabled = true;
  p.events = [{ id: 'a', kind: 'Catch', side: 'Left', t: 1.5 }];
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() => parseProject({ ...p, segment: [3, 1] }));
  assert.throws(() =>
    parseProject({ ...p, frames: [{ t: 1, points: [pt()] }] }),
  );
  assert.throws(() =>
    parseProject({ ...p, target: [{ t: 1, points: { constructor: pt() } }] }),
  );
  assert.throws(() => parseProject({ ...p, video: { ...p.video, fps: 0 } }));
});
