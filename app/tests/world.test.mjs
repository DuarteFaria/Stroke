import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, parseProject } from '../lib/motion.ts';
import { worldPoseAt, projectWorld, stabilizeWorld, worldViewBounds } from '../lib/world.ts';
const pose = (z = 0, v = .9) => Array.from({ length: 33 }, () => ({ x: .2, y: -.4, z, v }));
const frame = (t, z = 0, v = .9) => ({ t, points: pose(), worldPoints: pose(z, v) });

test('v2 world coordinates survive JSON roundtrip; v1 projects remain readable', () => {
  const p = emptyProject(); p.video.duration = 20; p.frames = [frame(0, -.3)];
  assert.equal(p.version, 2);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))), p);
  p.version = 1; delete p.frames[0].worldPoints;
  assert.equal(parseProject(p).version, 1);
  assert.equal(worldPoseAt(p.frames, 0), null);
});
test('invalid 3D arrays and nonfinite or excessive depth are rejected', () => {
  for (const invalid of [[], {}, pose().slice(1), pose(NaN), pose(Infinity), pose(11)]) {
    const p = emptyProject(); p.video.duration = 20; p.frames = [frame(0)];
    p.frames[0].worldPoints = invalid;
    assert.throws(() => parseProject(p));
  }
});
test('3D interpolation preserves depth and conservative visibility without changing raw points', () => {
  const frames = [frame(0, -.2), frame(.1, .2, .4)];
  const original = JSON.stringify(frames);
  assert.equal(worldPoseAt(frames, .05)[0].z, 0);
  assert.equal(worldPoseAt(frames, .05)[0].v, .4);
  assert.equal(worldPoseAt(frames, .1)[0].z, .2);
  assert.equal(JSON.stringify(frames), original);
  assert.equal(worldPoseAt(frames, 1), null);
});
test('missing data, transitions, restarts and long gaps do not create 3D motion', () => {
  for (const change of [{worldPoints:null}, {worldPoints:undefined}, {points:null}, {transition:true}, {breakBefore:true}, {t:1}]) {
    assert.equal(worldPoseAt([frame(0), {...frame(.1), ...change}], .05), null);
  }
  assert.equal(worldPoseAt([{...frame(0), transition:true}], 0), null);
  assert.equal(worldPoseAt([], 0), null);
});
test('side view uses depth on screen and top view removes vertical displacement', () => {
  const p = {x:.2, y:-.3, z:.4, v:1};
  assert.ok(Math.abs(projectWorld(p, Math.PI/2, 0).x - 220) < 1e-8);
  assert.ok(Math.abs(projectWorld(p, 0, Math.PI/2).y - 120) < 1e-8);
});

test('display smoothing reduces isolated jitter without changing source or visibility', () => {
  const frames = [frame(0), frame(.033,.1), frame(.066)];
  const before = JSON.stringify(frames);
  const result = stabilizeWorld(frames);
  assert.ok(result[1].worldPoints[15].z < .1);
  assert.equal(result[1].worldPoints[15].v, .9);
  assert.equal(JSON.stringify(frames), before);
  frames[1].worldPoints = pose(.1, .3);
  assert.equal(stabilizeWorld(frames)[1].worldPoints[15].z, .1);
});
test('display smoothing respects restarts, missing frames and user-marked cuts', () => {
  const frames = [frame(0), {...frame(.03,1),breakBefore:true}];
  assert.equal(stabilizeWorld(frames)[0].worldPoints[15].z, 0);
  assert.equal(stabilizeWorld(frames)[1].worldPoints[15].z, 1);
  delete frames[1].breakBefore;
  assert.equal(stabilizeWorld(frames,[[.01,.02]])[0].worldPoints[15].z, 0);
  assert.equal(stabilizeWorld(frames,[[0,.01]])[0].worldPoints, null);
  assert.equal(stabilizeWorld([frame(0),{t:.01,points:null},frame(.02,1)])[0].worldPoints[15].z, 0);
});
test('camera fits translated subjects in rotated views with a fixed clip scale', () => {
  const frames = [frame(0),frame(.1,.3)];
  frames.forEach(f=>f.worldPoints.forEach((p,i)=>{p.x=2+i*.01;p.y=-1+i*.02;}));
  const view = worldViewBounds(frames);
  for (const yaw of [0, Math.PI/2,Math.PI]) {
    const p = projectWorld(frames[0].worldPoints[15],yaw,0,1,view);
    assert.ok(p.x>10 && p.x<310 && p.y>10 && p.y<350);
  }
  assert.ok(Number.isFinite(worldViewBounds([]).scale));
});
