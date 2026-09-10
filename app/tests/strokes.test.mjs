import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, parseProject } from '../lib/motion.ts';
import { suggestStrokes, mergeSuggestions, strokeSummary } from '../lib/strokes.ts';

function fixture() {
  const p = emptyProject();
  p.video = { name: 'test.mp4', size: 1, duration: 5, width: 1000, height: 1000, fps: 30 };
  p.segment = [0, 4];
  p.frames = Array.from({length: 121}, (_,i) => {
    const t=i/30;
    const points=Array.from({length:33},()=>({x:.5,y:.4,v:1}));
    points[11].x=.4;points[12].x=.6;
    points[15].y=.4-.15*Math.cos(2*Math.PI*t);
    points[16].y=.4+.15*Math.cos(2*Math.PI*t);
    return { t, points };
  });
  return p;
}
const event = (id,t,kind,side,review='confirmed') => ({id,t,kind,side,review});
test('suggestions require full visible excursions, remain unconfirmed and never change source data', () => {
  const p=fixture(), before=JSON.stringify(p);
  const events=suggestStrokes(p);
  assert.ok(events.length>=8);
  assert.ok(events.every(e=>e.source==='automatic' && e.review==='suggested' && e.originalT===e.t));
  assert.equal(new Set(events.map(e=>e.id)).size,events.length);
  assert.equal(strokeSummary({...p,events}).rate,null);
  assert.equal(strokeSummary({...p,events}).pairs.length,0);
  assert.equal(JSON.stringify(p),before);
  for(const f of p.frames) f.points[15].v=f.points[16].v=.1;
  assert.deepEqual(suggestStrokes(p),[]);
});
test('still footage and transitions produce no invented complete strokes', () => {
  const p=fixture();
  p.frames.forEach(f=> { f.points[15].y=.5;f.points[16].y=.5; });
  assert.deepEqual(suggestStrokes(p),[]);
  const q=fixture();q.transitions=[[0,4]];
  assert.deepEqual(suggestStrokes(q),[]);
  const r=fixture();r.frames.forEach((f,i)=>f.breakBefore=i%5===0);
  assert.deepEqual(suggestStrokes(r),[]);
  const g=fixture();g.frames=g.frames.filter((_,i)=>i%9===0);
  assert.deepEqual(suggestStrokes(g),[]);
});
test('rerun preserves reviewed, adjusted, ignored and manual markers without duplicates', () => {
  const p=fixture(), suggestions=suggestStrokes(p);
  const reviewed={...suggestions[0],review:'confirmed'};
  const skipped={...suggestions[1],review:'skipped'};
  const adjusted={...suggestions[2],t:suggestions[2].t+.3,source:'manual'};
  const result=mergeSuggestions([reviewed,skipped,adjusted], suggestions,p.segment);
  assert.ok(result.includes(reviewed)&&result.includes(skipped)&&result.includes(adjusted));
  assert.equal(result.length,suggestions.length);
  assert.deepEqual(mergeSuggestions(result,suggestions,p.segment),result);
});
test('timing uses alternating catches, same-side water duration and shows sample counts', () => {
  const p=fixture();p.events=[event('a',.5,'Catch','Left'),event('b',.8,'Exit','Left'),event('c',1,'Catch','Right'),event('d',1.4,'Exit','Right'),event('e',1.5,'Catch','Left')];
  const s=strokeSummary(p);
  assert.equal(s.rate,120);assert.equal(s.intervals,2);assert.equal(s.pairs.length,2);
  assert.ok(Math.abs(s.left-.3)<1e-9);assert.ok(Math.abs(s.right-.4)<1e-9);
  assert.equal(s.incomplete,1);
});
test('missing markers, unreviewed catches, duplicate times and cuts cannot bridge into measurements', () => {
  const p=fixture();
  p.events=[event('a',.2,'Catch','Left'),event('b',.4,'Catch','Left','suggested'),event('c',.6,'Exit','Left')];
  assert.equal(strokeSummary(p).pairs.length,0);
  p.events=[event('a',.2,'Catch','Left'),event('b',.2,'Exit','Left'),event('c',.2,'Catch','Right')];
  assert.equal(strokeSummary(p).pairs.length,0);assert.equal(strokeSummary(p).rate,null);
  p.events=[event('a',.2,'Catch','Left'),event('b',.6,'Exit','Left'),event('c',.7,'Catch','Right')];
  p.transitions=[[.3,.4]];
  assert.equal(strokeSummary(p).pairs.length,0);assert.equal(strokeSummary(p).rate,null);
  p.transitions=[];p.frames[10].breakBefore=true;
  assert.equal(strokeSummary(p).pairs.length,0);assert.equal(strokeSummary(p).rate,null);
});
test('review state round-trips and invalid review metadata is rejected', () => {
  const p=fixture();p.events=suggestStrokes(p);p.events[0].review='skipped';
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))),p);
  const invalid=structuredClone(p);invalid.events[0].review='trusted';
  assert.throws(()=>parseProject(invalid));
  const duplicate=structuredClone(p);duplicate.events.push(duplicate.events[0]);assert.throws(()=>parseProject(duplicate));
  const legacy=fixture();legacy.events=[{id:'a',t:.2,kind:'Catch',side:'Left'},{id:'b',t:.5,kind:'Exit',side:'Left'}];
  assert.equal(strokeSummary(parseProject(legacy)).pairs.length,1);
});
