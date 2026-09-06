import test from 'node:test';
import assert from 'node:assert/strict';
import {
  poseAt,
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
