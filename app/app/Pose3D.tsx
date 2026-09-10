'use client';
import { useMemo, useRef, useState } from 'react';
import { BONES, JOINTS, type Project } from '@/lib/motion';
import { projectWorld, worldPoseAt, stabilizeWorld, worldViewBounds, UPPER_JOINTS } from '@/lib/world';

export default function Pose3D({ project, time, available }: { project: Project; time: number; available: boolean }) {
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [stabilized, setStabilized] = useState(true);
  const [showUncertain, setShowUncertain] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const hasWorld = useMemo(() => project.frames.some(f => f.worldPoints?.length), [project.frames]);
  const excluded = project.transitions?.some(([a, b]) => time >= a && time <= b);
  const segmentFrames = useMemo(() => project.frames.filter(f => f.t >= project.segment[0] && f.t <= project.segment[1]), [project.frames, project.segment]);
  const previewFrames = useMemo(() => stabilizeWorld(segmentFrames, project.transitions), [segmentFrames, project.transitions]);
  const view = useMemo(() => worldViewBounds(previewFrames), [previewFrames]);
  const pose = available && !excluded ? worldPoseAt(stabilized ? previewFrames : segmentFrames, time) : null;
  const joints = UPPER_JOINTS.filter(j => !pose || showUncertain || pose[j].v >= .35);
  const projected = pose?.map(p => projectWorld(p, yaw, pitch, zoom, view));
  const bones = BONES.filter(([a, b]) => joints.includes(a) && joints.includes(b));
  const color = (j: number) => [11, 13, 15].includes(j) ? '#4ee08a' : [12, 14, 16].includes(j) ? '#3fc8ff' : '#f2ede0';
  const preset = (y: number, p: number) => { setYaw(y); setPitch(p); };
  return <section className="pose3d" aria-label="Vista 3D experimental">
    <header><h2>Movimento 3D</h2><span>Experimental</span></header>
    <p>Estimativa do tronco e braços · {time.toFixed(2)} s · {stabilized ? 'Suavizada' : 'Original'}</p>
    <div className="pose3d-presets" aria-label="Orientação da vista">
      <button onClick={() => preset(0, 0)}>Original</button>
      <button onClick={() => preset(Math.PI / 2, 0)}>Rodar 90°</button>
      <button onClick={() => preset(0, Math.PI / 2)}>De cima</button>
      <button onClick={() => { preset(0, 0); setZoom(1); }}>Repor</button>
    </div>
    <svg viewBox="0 0 320 360" aria-label="Esqueleto 3D estimado; use os controlos abaixo para rodar" onPointerDown={e => {
      if (e.button !== 0) return;
      drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
      setYaw(y => ((y + dx * .012 + 3*Math.PI) % (2*Math.PI)) - Math.PI);
      setPitch(p => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, p + dy * .012)));
      drag.current = { x: e.clientX, y: e.clientY };
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <defs><pattern id="pose3d-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M 30 0 L 0 0 0 30" fill="none" stroke="#ffffff0c" /></pattern></defs>
      <rect width="320" height="360" fill="url(#pose3d-grid)" />
      {pose && projected && joints.length > 0 ? <>
        {bones.toSorted(([a,b], [c,d]) => (projected[c].depth + projected[d].depth) - (projected[a].depth + projected[b].depth)).map(([a,b]) => {
          const uncertain = Math.min(pose[a].v, pose[b].v) < .7;
          return <line key={`${a}-${b}`} x1={projected[a].x} y1={projected[a].y} x2={projected[b].x} y2={projected[b].y} stroke={color(b)} strokeWidth="4" strokeLinecap="round" strokeDasharray={uncertain ? '5 7' : undefined} opacity={uncertain ? .45 : 1} />;
        })}
        {joints.toSorted((a,b) => projected[b].depth - projected[a].depth).map(j => <circle key={j} cx={projected[j].x} cy={projected[j].y} r="5" fill={pose[j].v < .7 ? '#111' : color(j)} stroke={color(j)} strokeWidth="2"><title>{JOINTS[j]}{pose[j].v < .7 ? ' — visibilidade reduzida' : ''}</title></circle>)}
      </> : <text x="160" y="180" textAnchor="middle" fill="#aaa" fontSize="13">{hasWorld ? 'Sem pontos visíveis suficientes' : 'Analisa o vídeo para obter 3D'}</text>}
    </svg>
    <p className="pose3d-legend"><span>● Esquerda</span><span>● Direita</span></p>
    <div className="pose3d-options">
      <label><input type="checkbox" checked={stabilized} onChange={e=>setStabilized(e.target.checked)} />Suavizar movimento</label>
      <label><input type="checkbox" checked={showUncertain} onChange={e=>setShowUncertain(e.target.checked)} />Mostrar pontos muito incertos</label>
    </div>
    {pose && joints.length < UPPER_JOINTS.length && <p>{UPPER_JOINTS.length-joints.length} pontos ocultos por visibilidade reduzida.</p>}
    <label>Rotação <input aria-label="Rotação 3D" type="range" min={-180} max={180} value={yaw * 180 / Math.PI} onChange={e => setYaw(Number(e.target.value) * Math.PI / 180)} /></label>
    <label>Inclinação <input aria-label="Inclinação 3D" type="range" min={-90} max={90} value={pitch * 180 / Math.PI} onChange={e => setPitch(Number(e.target.value) * Math.PI / 180)} /></label>
    <label>Zoom <input aria-label="Zoom 3D" type="range" min={.5} max={3} step={.05} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label>
    {!hasWorld && <p>Projetos antigos: volta a analisar o vídeo original. A nova análise substitui as correções no trecho selecionado.</p>}
  </section>;
}
