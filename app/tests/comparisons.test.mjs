import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject } from '../lib/motion.ts';
import { comparisonStrokes, comparisonStats, strokeSummary } from '../lib/strokes.ts';

function fixture() {
  const p = emptyProject();
  p.segment = [0,3]; p.video = {...p.video, duration:3, width:1000, height:500};
  p.events = [
    ['a',0,'Catch','Left'],['b',.3,'Exit','Left'],['c',.5,'Catch','Right'],
    ['d',.9,'Exit','Right'],['e',1,'Catch','Left'],['f',1.3,'Exit','Left'],
    ['g',1.5,'Catch','Right'],['h',1.9,'Exit','Right'],['i',2,'Catch','Left'],
  ].map(([id,t,kind,side]) => ({id,t,kind,side,review:'confirmed'}));
  p.frames = Array.from({length:91},(_,i) => {
    const points=Array.from({length:33},()=>({x:.5,y:.5,v:1}));
    points[11]={x:.4,y:.5,v:1}; points[15]={x:.5,y:.7,v:1};
    points[12]={x:.6,y:.5,v:1}; points[16]={x:.5,y:.7,v:1};
    return {t:i/30,points};
  });
  return p;
}

test('pairs remain usable without the next catch; full cycles measure recovery and cycle separately', () => {
  const rows=comparisonStrokes(fixture());
  assert.equal(rows.length,4);
  assert.equal(rows[0].water,.3); assert.equal(rows[0].recovery,.7); assert.equal(rows[0].cycle,1);
  assert.ok(Math.abs(rows[1].water-.4)<1e-9);
  assert.equal(rows[3].cycle,null); assert.equal(rows[3].recovery,null);
  assert.equal(rows.filter(r=>r.cycle!==null).length,3);
});

test('ambiguous markers, omitted catches, cuts and segment boundaries do not create cycles', () => {
  for (const change of [
    p=>p.events[2].review='suggested',
    p=>p.events[2].review='skipped',
    p=>p.events.splice(2,1),
    p=>p.events.push({...p.events[2],id:'duplicate'}),
    p=>p.transitions=[[.7,.8]],
    p=>p.frames[20].breakBefore=true,
    p=>p.segment=[0,.95],
  ]) {
    const p=fixture(); change(p);
    assert.equal(comparisonStrokes(p).find(s=>s.id==='a')?.cycle,null);
  }
  const p=fixture(); p.events[1].review='suggested';
  assert.ok(!comparisonStrokes(p).some(s=>s.id==='a'));
});

test('timing statistics exclude missing values', () => {
  const stats=comparisonStats([null,.3,.5]);
  assert.deepEqual(stats,{count:2,mean:.4,min:.3,max:.5});
  assert.deepEqual(comparisonStats([null]),{count:0,mean:null,min:null,max:null});
});

test('removed markers cannot suppress confirmed pairs, cadence or full cycles; restoring them takes effect', () => {
  const p=fixture();
  const expected=strokeSummary(p), rows=comparisonStrokes(p);
  const removed=[
    {id:'removed-entry',t:.2,kind:'Catch',side:'Left',review:'skipped'},
    {id:'removed-exit',t:.3,kind:'Exit',side:'Left',review:'skipped'},
    {id:'removed-opposite',t:.6,kind:'Catch',side:'Right',review:'skipped'},
  ];
  p.events.push(...removed);
  const before=JSON.stringify(p);
  assert.deepEqual(strokeSummary(p),expected);
  assert.deepEqual(comparisonStrokes(p),rows);
  assert.equal(JSON.stringify(p),before);
  removed[0].review='suggested';
  assert.ok(!comparisonStrokes(p).some(s=>s.id==='a'));
});

test('left pair with removed intermediate catch and duplicate exit remains measurable', () => {
  const p=fixture();
  p.events=[
    ['a',.597199,'Catch','Left','confirmed'],
    ['b',.804844,'Catch','Left','skipped'],
    ['c',1.305301,'Exit','Left','skipped'],
    ['d',1.305301,'Exit','Left','confirmed'],
    ['e',1.798372,'Catch','Right','confirmed'],
    ['f',2.333332,'Exit','Right','confirmed'],
  ].map(([id,t,kind,side,review])=>({id,t,kind,side,review}));
  const rows=comparisonStrokes(p);
  assert.equal(rows.length,2);
  assert.ok(Math.abs(rows[0].water-.708102)<1e-9);
  assert.ok(Math.abs(rows[1].water-.53496)<1e-9);
  assert.ok(rows.every(s=>s.cycle===null));
});
