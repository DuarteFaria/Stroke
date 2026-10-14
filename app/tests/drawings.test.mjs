import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, parseProject, shotAt } from '../lib/motion.ts';
import {
  HOLD,
  FADE,
  angleDeg,
  hitTest,
  nearestJoint,
  parseDrawings,
  resolvePoints,
  simplify,
  snap45,
  visibility,
} from '../lib/drawings.ts';

const project = () => {
  const p = emptyProject();
  p.video = { name: 'a.mp4', size: 1, duration: 10, width: 1000, height: 500, fps: 30 };
  p.segment = [0, 10];
  return p;
};
const arrow = (extra = {}) => ({
  id: 'a1',
  kind: 'arrow',
  t: 2,
  color: '#ff2e2e',
  size: 2,
  points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5, joint: 13 }],
  ...extra,
});
const roundTrip = (p) => parseProject(JSON.parse(JSON.stringify(p)));

test('old projects without drawings still open untouched', () => {
  const p = roundTrip(project());
  assert.equal(p.drawings, undefined);
});
test('valid drawings survive a save and reopen', () => {
  const p = project();
  p.drawings = [
    arrow(),
    { id: 't1', kind: 'text', t: 1, whole: true, color: '#ffffff', size: 1, points: [{ x: 0.2, y: 0.2 }], text: 'Cotovelo alto' },
    { id: 'p1', kind: 'plumb', t: 3, color: '#121212', size: 3, dashed: true, points: [{ x: 0.4, y: 0.6, joint: 23 }], axis: 'v' },
    { id: 'g1', kind: 'angle', t: 3, color: '#2f54ff', size: 2, points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, { x: 0.3, y: 0.1 }] },
  ];
  assert.deepEqual(roundTrip(p).drawings, p.drawings);
});
test('malformed drawings reject the project like other bad fields', () => {
  const bad = [
    'nope',
    [arrow({ t: Number.NaN })],
    [arrow({ t: 99 })],
    [arrow({ color: 'red' })],
    [arrow({ size: 4 })],
    [arrow({ points: [{ x: 0, y: 0 }] })],
    [arrow({ points: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5, joint: 40 }] })],
    [arrow({ points: [{ x: 0, y: 0 }, { x: 99, y: 0.5 }] })],
    [arrow({ whole: 'yes' })],
    [arrow(), arrow()],
    [{ ...arrow(), kind: 'text', points: [{ x: 0, y: 0 }], text: '' }],
    [{ ...arrow(), kind: 'text', points: [{ x: 0, y: 0 }], text: 'x'.repeat(301) }],
    [{ ...arrow(), kind: 'plumb', points: [{ x: 0, y: 0 }], axis: 'd' }],
    [{ ...arrow(), kind: 'pen', points: Array.from({ length: 4001 }, () => ({ x: 0, y: 0 })) }],
    Array.from({ length: 2001 }, (_, i) => arrow({ id: `a${i}` })),
  ];
  for (const drawings of bad) assert.throws(() => roundTrip({ ...project(), drawings }));
});
test('tools from a newer Stroke are skipped, unknown keys dropped', () => {
  const drawings = parseDrawings([arrow({ extra: 1 }), { id: 'z', kind: 'hologram', t: 0 }], 10);
  assert.equal(drawings.length, 1);
  assert.equal('extra' in drawings[0], false);
});
test('a pinned drawing shows from its moment for the hold window, fading only while playing', () => {
  const d = arrow();
  assert.equal(visibility(d, 1.9), 0);
  assert.equal(visibility(d, 1.99), 1);
  assert.equal(visibility(d, 2), 1);
  assert.equal(visibility(d, 2 + HOLD - 0.01), 1);
  assert.ok(visibility(d, 2 + HOLD - FADE / 2, true) > 0 && visibility(d, 2 + HOLD - FADE / 2, true) < 1);
  assert.equal(visibility(d, 2 + HOLD + 0.01), 0);
  assert.equal(visibility(arrow({ whole: true }), 9), 1);
});
test('a whole-shot drawing ends at the next camera cut or transition', () => {
  const cuts = [[4, 4.04], [7, 8]];
  assert.deepEqual(shotAt(2, cuts, 10), [0, 4]);
  assert.deepEqual(shotAt(5, cuts, 10), [4.04, 7]);
  assert.deepEqual(shotAt(9, cuts, 10), [8, 10]);
  assert.deepEqual(shotAt(7.5, cuts, 10), [7, 8]);
  assert.deepEqual(shotAt(3, [], 10), [0, 10]);
  const d = arrow({ whole: true });
  assert.equal(visibility(d, 0, false, cuts), 1);
  assert.equal(visibility(d, 3.9, false, cuts), 1);
  assert.equal(visibility(d, 5, false, cuts), 0);
  assert.equal(visibility(d, 9, false, cuts), 0);
  assert.equal(visibility(arrow({ whole: true, t: 5 }), 6, false, cuts), 1);
  assert.equal(visibility(arrow({ whole: true, t: 5 }), 2, false, cuts), 0);
});
test('angles are measured on the picture, not in normalised units', () => {
  assert.equal(Math.round(angleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, 100, 100)), 90);
  // 0.1 wide by 0.2 tall on a 2:1 frame is a square: 45°.
  assert.equal(Math.round(angleDeg({ x: 0.1, y: 0.2 }, { x: 0, y: 0.2 }, { x: 0.1, y: 0 }, 1000, 500)), 45);
  assert.equal(angleDeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 1, 1), null);
});
test('shift snaps to the nearest 45° on screen', () => {
  const b = snap45({ x: 0, y: 0 }, { x: 0.5, y: 0.05 }, 1000, 500);
  assert.ok(Math.abs(b.y) < 1e-9 && b.x > 0.49);
});
test('joint-anchored points follow the athlete and fall back when the joint is missing', () => {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, v: 1 }));
  pose[13] = { x: 0.6, y: 0.7, v: 1 };
  const d = arrow();
  // Head follows the elbow; the free tail moves with it, keeping the shape.
  const [tail, head] = resolvePoints(d, pose);
  assert.deepEqual(head, { x: 0.6, y: 0.7 });
  assert.ok(Math.abs(tail.x - 0.2) < 1e-9 && Math.abs(tail.y - 0.3) < 1e-9);
  assert.deepEqual(resolvePoints(d, null), [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }]);
  const lost = pose.slice();
  lost[13] = { x: 0.9, y: 0.9, v: 0 };
  assert.deepEqual(resolvePoints(d, lost)[1], { x: 0.5, y: 0.5 });
  assert.equal(nearestJoint(pose, { x: 0.605, y: 0.7 }, [11, 13], 1000, 500, 16), 13);
  assert.equal(nearestJoint(pose, { x: 0.7, y: 0.7 }, [13], 1000, 500, 16), null);
});
test('hit-testing grabs strokes and outlines, not empty space', () => {
  const opts = { font: 20 };
  const line = arrow();
  const P = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  assert.ok(hitTest(line, P, { x: 50, y: 4 }, 5, opts));
  assert.ok(!hitTest(line, P, { x: 50, y: 9 }, 5, opts));
  const rect = { ...line, kind: 'rect' };
  assert.ok(hitTest(rect, [{ x: 0, y: 0 }, { x: 100, y: 100 }], { x: 98, y: 50 }, 5, opts));
  assert.ok(!hitTest(rect, [{ x: 0, y: 0 }, { x: 100, y: 100 }], { x: 50, y: 50 }, 5, opts));
  const spot = { ...line, kind: 'spotlight' };
  const C = [{ x: 50, y: 50 }, { x: 80, y: 70 }];
  assert.ok(hitTest(spot, C, { x: 55, y: 55 }, 5, opts));
  assert.ok(!hitTest(spot, C, { x: 55, y: 55 }, 5, { ...opts, edge: true }));
  const plumb = { ...line, kind: 'plumb', axis: 'v' };
  assert.ok(hitTest(plumb, [{ x: 40, y: 10 }], { x: 42, y: 400 }, 5, opts));
  const text = { ...line, kind: 'text', text: 'Olá' };
  assert.ok(hitTest(text, [{ x: 10, y: 10 }], { x: 20, y: 20 }, 2, opts));
  assert.ok(!hitTest(text, [{ x: 10, y: 10 }], { x: 200, y: 20 }, 2, opts));
});
test('freehand simplification drops collinear points but keeps corners', () => {
  const pts = [...Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 })), { x: 19, y: 10 }];
  const out = simplify(pts, 0.5);
  assert.deepEqual(out, [{ x: 0, y: 0 }, { x: 19, y: 0 }, { x: 19, y: 10 }]);
});
