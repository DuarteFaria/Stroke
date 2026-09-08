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
  const selectMode = value => run(`(() => { const input = document.querySelector('input[name="stroke-mode"][value="${value}"]'); if (!input || input.disabled) throw Error('Mode unavailable: ${value}'); input.click(); })()`);
  const settle = () => run(`new Promise(resolve => setTimeout(resolve, 2000))`);
  assert.equal((await fetch(`${api}/health`)).status, 401);
  assert.equal((await fetch(`${api}/health`, { headers: { 'X-Stroke-Token': token, Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(`${api}/health`, { headers: { 'X-Stroke-Token': token } })).status, 200);
  const checks = ['renderer', 'authenticated analyzer', 'foreign origin rejected'];
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
  await click('Detetar o atleta');
  const original = JSON.parse(await fs.readFile(fixture, 'utf8'));
  if (original.corrections.length || original.target.length) {
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Detetar')`);
    await click('Detetar');
  }
  await waitFor(`document.body.innerText.includes('Atleta encontrado em')`, 90000);
  await waitFor(`![...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Cancelar') && !document.body.innerText.includes('A detetar')`);
  checks.push('real inference through renderer');
  await selectMode('paddle');
  await waitFor(`document.querySelector('input[name="stroke-mode"][value="paddle"]')?.checked && document.body.innerText.includes('Marca A→B')`);
  await settle();
  await capture('paddle-annotation.png');
  await selectMode('correct');
  await waitFor(`document.querySelector('input[name="stroke-mode"][value="correct"]')?.checked && document.body.innerText.includes('Pausa e arrasta')`);
  await settle();
  await capture('body-analysis.png');
  await run(`(() => { const t = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Desktop smoke: correção e recuperação'); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await click('Guardar');
  await waitFor(`document.body.innerText.includes('Projeto guardado.')`);
  const project = JSON.parse(await fs.readFile(fixture, 'utf8'));
  assert(project.frames.some(f => f.points));
  assert.equal(project.notes, 'Desktop smoke: correção e recuperação');
  checks.push('native save to opened project', 'saved inference and notes');
  nextOpen = fixture;
  await click('Abrir projeto');
  await waitFor(`document.querySelector('video')?.readyState >= 2`);
  assert.equal(await run(`document.querySelector('textarea').value`), project.notes);
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
