// Integration checks run only with --smoke-test and explicit local fixtures.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
module.exports = async function smokeTest({ win, dialog, api, token, data }) {
  const capture = async name => {
    if (!process.env.STROKE_SCREENSHOT_DIR) return;
    await fs.mkdir(process.env.STROKE_SCREENSHOT_DIR, { recursive: true });
    const image = await win.webContents.capturePage();
    await fs.writeFile(path.join(process.env.STROKE_SCREENSHOT_DIR, name), image.toPNG());
  };
  const run = async code => {
    const result = await win.webContents.executeJavaScript(`(async () => { try { return { value: await (${code}) }; } catch (e) { return { error: String(e) }; } })()`);
    if (result.error) throw Error(`${result.error}; script: ${code.slice(0, 160)}`);
    return result.value;
  };
  const waitFor = async (code, timeout = 20000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { if (await run(code)) return; await new Promise(r => setTimeout(r, 150)); }
    throw Error(`Timed out: ${code}`);
  };
  const click = label => run(`(() => { const b = [...document.querySelectorAll('button')].find(b => { const copy = b.cloneNode(true); copy.querySelectorAll('.sr-only').forEach(n => n.remove()); return copy.textContent.trim() === ${JSON.stringify(label)}; }); if (!b || b.disabled) throw Error('Button unavailable: ' + ${JSON.stringify(label)}); b.click(); })()`);
  const settle = () => run(`new Promise(resolve => setTimeout(resolve, 2000))`);
  assert.equal((await fetch(`${api}/health`)).status, 401);
  assert.equal((await fetch(`${api}/health`, { headers: { 'X-Stroke-Token': token, Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(`${api}/health`, { headers: { 'X-Stroke-Token': token } })).status, 200);
  const checks = ['renderer', 'authenticated analyzer', 'foreign origin rejected'];
  // Main-process fetch bypasses the document CSP. Exercise the actual renderer
  // on every CI run, even without a personal project/video fixture.
  const rendererHealth = await run(`(async () => {
    const {token}=await window.strokeDesktop.config();
    const response=await fetch('/api/health',{headers:{'X-Stroke-Token':token}});
    if (!response.ok) throw Error('Renderer analyzer health: '+response.status);
    return response.json();
  })()`);
  assert.equal(rendererHealth.ok,true);
  assert.equal(rendererHealth.modelReady,true);
  await waitFor(`!document.body.innerText.includes('Detetor desligado')`);
  checks.push('renderer-to-analyzer connection under document CSP');
  assert.equal(await run(`fetch('/api/health').then(r => r.status)`), 401);
  assert.equal(await run(`fetch('/index.html', { headers: { Range: 'bytes=0-9' } }).then(async r => r.status + ' ' + (await r.text()).length)`), '206 10');
  checks.push('proxy keeps analyzer auth', 'byte ranges');
  if (process.env.STROKE_SMOKE_ANALYSIS_VIDEO) {
    const clip = await fs.readFile(process.env.STROKE_SMOKE_ANALYSIS_VIDEO);
    for (const quality of ['standard', 'detailed']) {
      const form = new FormData();
      form.set('file', new Blob([clip], { type: 'video/mp4' }), 'smoke.mp4');
      form.set('start', '0'); form.set('end', '1'); form.set('quality', quality);
      const headers = { 'X-Stroke-Token': token };
      const response = await fetch(`${api}/analyze`, { method: 'POST', headers, body: form });
      assert.equal(response.status, 200, await response.clone().text());
      const { id } = await response.json();
      let job;
      const deadline = Date.now() + 90000;
      do {
        await new Promise(resolve => setTimeout(resolve, 200));
        job = await (await fetch(`${api}/jobs/${id}`, { headers })).json();
      } while (['queued', 'running'].includes(job.status) && Date.now() < deadline);
      assert.equal(job.status, 'done', JSON.stringify(job));
      assert(job.result.frames.length > 0);
      checks.push(`packaged video decoding and ${quality} inference`);
    }
  }
  if (!process.env.STROKE_SMOKE_PROJECT || !process.env.STROKE_SMOKE_VIDEO) return checks;
  let nextOpen = process.env.STROKE_SMOKE_PROJECT;
  const saved = path.join(data, 'smoke-saved.stroke.json');
  // Never overwrite the input fixture; the app opens a test-owned copy.
  const fixture = path.join(data, `fixture-${Date.now()}.stroke.json`);
  await fs.copyFile(nextOpen, fixture); nextOpen = fixture;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [nextOpen] });
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
  dialog.showMessageBox = async () => ({ response: 0 });
  await click('Abrir projeto');
  await waitFor(`document.body.innerText.includes('Escolher o original')`);
  nextOpen = process.env.STROKE_SMOKE_VIDEO;
  await click('Escolher o original');
  await waitFor(`document.querySelector('video')?.readyState >= 2`);
  await capture('studio-overview.png');
  checks.push('native project open', 'native video open and decode');
  await click('Deteção');
  await click('Detetar a minha remada');
  const original = JSON.parse(await fs.readFile(fixture, 'utf8'));
  if (original.corrections.length || original.target.length) {
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Detetar')`);
    await click('Detetar');
  }
  await waitFor(`document.body.innerText.includes('Deteção pronta.')`, 90000);
  await waitFor(`![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Cancelar') && !document.body.innerText.includes('A detetar')`);
  checks.push('real inference through renderer');
  if (process.env.STROKE_SMOKE_3D) {
    await click('Vista 3D');
    await waitFor(`document.querySelectorAll('.pose3d circle').length > 0`);
    assert.equal(await run(`document.querySelector('.pose3d-legend').innerText.includes('Esquerda do atleta')`),true);
    await click('Rodar 90°');
    assert.equal(await run(`document.querySelector('input[aria-label="Rotação 3D"]').value`),'90');
    await click('Repor');
    await settle();
    await capture('pose3d-stabilized.png');
    await run(`document.querySelector('.pose3d-options input').click()`);
    await waitFor(`document.querySelector('.pose3d > p').innerText.includes('Original')`);
    await run(`document.querySelector('.pose3d-options input').click()`);
    checks.push('3D anatomical labels, rotation, reset and original comparison');
    await click('Vista 3D');
  }
  if (process.env.STROKE_SMOKE_COMPARISONS) {
    await click('Tempos');
    await waitFor(`document.querySelectorAll('.stroke-bars button').length === 4`);
    assert.equal(await run(`!!document.querySelector('.comparison-curve')`),false);
    assert.equal(await run(`document.querySelector('.comparison-table tbody tr td').textContent`),'0.30 s');
    assert.equal(await run(`document.querySelector('.comparison-verdict').textContent`),'A direita fica 0.10 s mais na água do que a esquerda (25%).');
    await run(`document.querySelector('.stroke-bars button').click()`);
    await waitFor(`!document.querySelector('video').paused`);
    await run(`document.querySelector('video').pause()`);
    await run(`document.querySelector('.stroke-comparison').scrollIntoView()`);
    await settle();
    await capture('comparison.png');
    win.setSize(1024,768);
    await settle();
    await run(`document.querySelector('.stroke-comparison').scrollIntoView()`);
    await settle();
    assert.equal(await run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),true);
    await capture('comparison-compact.png');
    checks.push('left/right means and verdict', 'per-stroke bars and replay', 'comparison compact layout');
    return checks;
  }
  assert.equal(await run(`!!document.querySelector('#stroke-comparison')`), false);
  assert.equal(await run(`document.querySelector('.view-tabs').getBoundingClientRect().height > 0`), true);
  assert.equal(await run(`document.querySelectorAll('.dock .marker').length`), original.events.filter(e => e.review !== 'skipped' && e.t >= original.segment[0] && e.t <= original.segment[1]).length);
  assert.equal(await run(`document.body.innerText.includes('Sugerir marcações') || document.body.innerText.includes('Rever sugestões')`), false);
  assert.equal(await run(`['Deteção','Tempos','Vista 3D'].every(label => [...document.querySelectorAll('.view-tabs button')].some(b => b.textContent.trim() === label)) && ['Editar ideal','Desenhar'].every(label => [...document.querySelectorAll('.dock-head .modes button')].some(b => b.textContent.trim() === label))`), true);
  await click('Deteção');
  assert.equal(await run(`document.querySelector('.inspector .setup').innerText.includes('Deteção detalhada') && document.querySelector('.inspector .setup').innerText.includes('Área do atleta')`), true);
  await click('Área do atleta');
  await waitFor(`document.body.innerText.includes('Arrasta à volta do atleta')`);
  await click('Cancelar seleção');
  await waitFor(`!document.body.innerText.includes('Arrasta à volta do atleta')`);
  await settle();
  await capture('analysis-controls.png');
  await run(`document.querySelector('button[aria-label="Fechar painel"]').click()`);
  checks.push('analysis preserves markers without suggestions', 'inline analysis controls and region selection');
  const pickMarker = sel => run(`(() => { document.querySelector(${JSON.stringify(sel)}).click(); document.querySelector('video').pause(); })()`);
  await run(`(() => { const v = document.querySelector('video'); v.currentTime = ${original.segment[0] + 0.5}; })()`);
  await settle();
  await run(`document.querySelector('button[title="Entrada · esquerda neste fotograma (1)"]').click()`);
  await waitFor(`document.querySelectorAll('.dock .marker-entry').length === 1`);
  await pickMarker('.dock .marker-entry');
  await waitFor(`document.querySelector('.dock-context')?.innerText.includes('Confirmada')`);
  const markerTime = await run(`document.querySelector('.dock-context time').textContent`);
  await click('Ajustar');
  await click('+1 fotograma');
  await waitFor(`document.querySelector('.dock-context time').textContent !== ${JSON.stringify(markerTime)}`);
  await click('Concluir');
  await run(`document.querySelector('button[aria-label="Anular"]').click()`);
  await waitFor(`document.querySelector('.dock-context')?.innerText.includes('Por rever')`);
  await click('Confirmar');
  await pickMarker('.dock .marker-entry');
  await waitFor(`document.querySelector('.dock-context')?.innerText.includes('Confirmada')`);
  await click('Remover');
  await waitFor(`!document.querySelector('.dock .marker-entry')`);
  await run(`document.querySelector('button[aria-label="Anular"]').click()`);
  await waitFor(`!!document.querySelector('.dock .marker-entry')`);
  await run(`(() => { const v = document.querySelector('video'); v.pause(); v.currentTime += .3; })()`);
  await settle();
  await run(`document.querySelector('button[title="Saída · esquerda neste fotograma (2)"]').click()`);
  await waitFor(`!!document.querySelector('.dock .marker-exit')`);
  await click('Tempos');
  await waitFor(`[...document.querySelectorAll('.comparison-table td')].some(x => x.textContent !== '—')`);
  assert.equal(await run(`!!document.querySelector('.view-tabs button[aria-pressed="true"]')`),true);
  await settle();
  await capture('tempos.png');
  await run(`document.querySelector('button[aria-label="Fechar painel"]').click()`);
  await settle();
  await capture('stroke-timeline.png');
  assert.equal(await run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), true);
  win.setSize(1024, 768);
  await settle();
  assert.equal(await run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), true);
  await capture('stroke-timeline-compact.png');
  win.setSize(1440, 940);
  await settle();
  await pickMarker('.dock .marker');
  await click('Ajustar');
  await settle();
  await capture('stroke-adjustment.png');
  await run(`document.querySelector('button[aria-label="Fechar a marcação"]').click()`);
  checks.push('visible body tools', 'manual marker', 'frame adjustment', 'confirmation and removal undo');
  await click('Editar ideal');
  await waitFor(`document.querySelector('.inspector')?.getAttribute('aria-label') === 'Editar ideal' && document.body.innerText.includes('Criar movimento ideal')`);
  await settle();
  await capture('ideal-tool.png');
  await click('Editar ideal');
  await waitFor(`!document.querySelector('.inspector')`);
  await settle();
  await capture('body-analysis.png');
  await click('Tempos');
  await run(`(() => { const t = document.querySelector('#notes'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Desktop smoke: correção e recuperação'); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click('Guardar');
  await waitFor(`document.body.innerText.includes('Projeto guardado.')`);
  const project = JSON.parse(await fs.readFile(fixture, 'utf8'));
  assert(project.frames.some(f => f.points));
  assert.equal(project.notes, 'Desktop smoke: correção e recuperação');
  assert(project.events.some(e => e.source === 'manual' && e.review === 'confirmed'));
  checks.push('native save to opened project', 'saved inference and notes');
  nextOpen = fixture;
  await click('Abrir projeto');
  await waitFor(`document.querySelector('video')?.readyState >= 2`);
  await settle();
  await click('Tempos');
  assert.equal(await run(`document.querySelector('#notes').value`), project.notes);
  checks.push('reopen with remembered video');
  await run(`window.strokeDesktop.snapshot(${JSON.stringify(JSON.stringify(project))}, true)`);
  const recovery = await run(`window.strokeDesktop.recover()`);
  assert.equal(JSON.parse(recovery.text).notes, project.notes);
  checks.push('disk recovery roundtrip');
  await run(`window.strokeDesktop.snapshot(${JSON.stringify(JSON.stringify(project))}, false)`);
  await run(`window.strokeDesktop.resetProject()`);
  // Cancelling Save must not mark unsaved edits as saved or write a file.
  dialog.showSaveDialog = async () => ({ canceled: true });
  assert.equal(await run(`window.strokeDesktop.saveProject(${JSON.stringify(JSON.stringify(project))}, 'test')`), false);
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: saved });
  assert.equal(await run(`window.strokeDesktop.saveProject(${JSON.stringify(JSON.stringify(project))}, 'test')`), true);
  assert.deepEqual(JSON.parse(await fs.readFile(saved, 'utf8')), project);
  checks.push('save cancellation', 'native Save As');
  return checks;
};
