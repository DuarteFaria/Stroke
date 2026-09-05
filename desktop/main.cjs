const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), 'stroke-desktop-smoke'));
let win, server, analyzer, origin, api, dirty = false, quitting = false;
let projectPath = null, videoPath = null;
let writeQueue = Promise.resolve();
const token = randomBytes(32).toString('hex');
const videos = new Map(), pending = new Map();
const data = () => app.getPath('userData');
const recoveryPath = () => path.join(data(), 'recovery.json');
const logPath = () => path.join(data(), 'desktop.log');
function log(message) { fs.appendFileSync(logPath(), `${new Date().toISOString()} ${message}\n`); }
async function atomic(file, text) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fsp.writeFile(temp, text, 'utf8'); await fsp.rename(temp, file); }
  finally { await fsp.rm(temp, { force: true }); }
}
function projectText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 30 * 1024 ** 2) throw Error('Projeto demasiado grande.');
  const p = JSON.parse(text);
  if (!p || typeof p !== 'object' || !p.video || !Array.isArray(p.frames)) throw Error('Projeto inválido.');
  return text;
}
async function locations() {
  try { return JSON.parse(await fsp.readFile(path.join(data(), 'locations.json'), 'utf8')); } catch { return {}; }
}
async function remember() {
  if (!projectPath) return;
  const map = await locations(); map[projectPath] = videoPath;
  await atomic(path.join(data(), 'locations.json'), JSON.stringify(map));
}
async function videoDescriptor(file) {
  const stat = await fsp.stat(file);
  if (!stat.isFile() || stat.size > 1024 ** 3) throw Error('O limite do vídeo é 1 GB.');
  const id = randomUUID(); videos.set(id, file);
  return { id, name: path.basename(file), size: stat.size, url: `${origin}/video/${id}` };
}
function senderOK(event) { return win && event.sender === win.webContents && event.senderFrame?.url.startsWith(`${origin}/`); }
function handle(name, fn) {
  ipcMain.handle(`stroke:${name}`, (event, ...args) => {
    if (!senderOK(event)) throw Error('Invalid sender');
    return fn(...args);
  });
}
function installIPC() {
  handle('config', () => ({ api, token, version: app.getVersion() }));
  handle('openProject', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Abrir projeto', filters: [{ name: 'Projeto Stroke', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fsp.stat(file)).size > 30 * 1024 ** 2) throw Error('Projeto com mais de 30 MB.');
    const text = projectText(await fsp.readFile(file, 'utf8'));
    const id = randomUUID(); pending.set(id, { file, video: (await locations())[file] || null });
    return { id, text };
  });
  handle('adoptProject', async (id) => {
    const entry = pending.get(id); if (!entry) throw Error('Projeto desconhecido.');
    pending.delete(id); projectPath = entry.file; videoPath = entry.video;
    try { return videoPath ? await videoDescriptor(videoPath) : null; } catch { return null; }
  });
  handle('openVideo', async () => {
    const result = await dialog.showOpenDialog(win, { title: 'Escolher vídeo', filters: [{ name: 'Vídeo', extensions: ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'] }], properties: ['openFile'] });
    return result.canceled ? null : videoDescriptor(result.filePaths[0]);
  });
  handle('rememberVideo', async (id) => {
    if (!videos.has(id)) throw Error('Vídeo desconhecido.');
    videoPath = videos.get(id); await remember();
  });
  handle('resetProject', () => { projectPath = null; videoPath = null; });
  handle('saveProject', async (text, name) => {
    projectText(text);
    let destination = projectPath;
    if (!destination) {
      const result = await dialog.showSaveDialog(win, { title: 'Guardar projeto', defaultPath: `${String(name).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'stroke'}.stroke.json`, filters: [{ name: 'Projeto Stroke', extensions: ['stroke.json'] }] });
      if (result.canceled || !result.filePath) return false;
      destination = result.filePath;
    }
    await atomic(destination, text); projectPath = destination; await remember();
    return true;
  });
  handle('snapshot', (text, isDirty) => {
    projectText(text);
    const snapshot = JSON.stringify({ text, dirty: !!isDirty, file: projectPath, video: videoPath });
    writeQueue = writeQueue.catch(() => {}).then(() => atomic(recoveryPath(), snapshot));
    return writeQueue;
  });
  handle('recover', async () => {
    let previous;
    try { previous = JSON.parse(await fsp.readFile(recoveryPath(), 'utf8')); } catch { return null; }
    if (!previous.dirty) return null;
    const result = await dialog.showMessageBox(win, { type: 'question', title: 'Recuperar trabalho', message: 'Há alterações por guardar da última sessão.', buttons: ['Recuperar', 'Descartar'], defaultId: 0, cancelId: 0 });
    if (result.response !== 0) { await fsp.rm(recoveryPath(), { force: true }); return null; }
    const id = randomUUID(); pending.set(id, { file: previous.file, video: previous.video });
    return { id, text: projectText(previous.text) };
  });
  ipcMain.on('stroke:dirty', (event, value) => { if (senderOK(event)) dirty = !!value; });
}
async function startServer() {
  const ui = app.isPackaged ? path.join(process.resourcesPath, 'ui') : path.join(root, 'app', 'desktop-dist');
  server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(403).end(); return; }
      const pathname = decodeURIComponent(new URL(req.url, origin).pathname);
      const isVideo = pathname.startsWith('/video/');
      if (isVideo && req.headers['x-stroke-token'] !== token) { res.writeHead(401).end(); return; }
      const file = isVideo ? videos.get(pathname.slice(7)) : path.resolve(ui, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file || (!isVideo && !file.startsWith(ui + path.sep))) { res.writeHead(404).end(); return; }
      const stat = await fsp.stat(file);
      if (!stat.isFile()) { res.writeHead(404).end(); return; }
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      res.setHeader('Content-Type', mime); res.setHeader('Content-Length', stat.size);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${api || ''}; object-src 'none'; frame-src 'none'; base-uri 'none'`);
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
}
async function startAnalyzer() {
  const command = app.isPackaged ? path.join(process.resourcesPath, 'analyzer', 'stroke-analyzer.exe') : path.join(root, '.venv', 'Scripts', 'python.exe');
  const args = app.isPackaged ? [] : ['-m', 'backend.desktop_entry'];
  const temp = path.join(data(), 'analysis-temp'); await fsp.mkdir(temp, { recursive: true });
  // This directory is exclusively owned by this single-instance app.
  for (const file of await fsp.readdir(temp)) if (/^tmp.*\.mp4$/.test(file)) await fsp.rm(path.join(temp, file), { force: true });
  analyzer = spawn(command, args, { cwd: app.isPackaged ? process.resourcesPath : root, windowsHide: true, env: { ...process.env, STROKE_TOKEN: token, STROKE_ORIGIN: origin, TEMP: temp, TMP: temp }, stdio: ['pipe', 'pipe', 'pipe'] });
  analyzer.stderr.on('data', chunk => log(chunk.toString()));
  analyzer.on('exit', (code) => {
    log(`Analyzer exited (${code})`);
    if (!quitting && api) { dialog.showErrorBox('Stroke', 'O analisador parou. Guarda o projeto e reinicia o Stroke.'); }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('O analisador não arrancou em 90 segundos.')), 90000);
    let buffer = '';
    analyzer.once('error', err => { clearTimeout(timer); reject(err); });
    analyzer.once('exit', code => { clearTimeout(timer); reject(Error(`O analisador terminou (${code}).`)); });
    analyzer.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const match = buffer.match(/STROKE_READY=(\{[^\n]+\})/);
      if (match) { api = `http://127.0.0.1:${JSON.parse(match[1]).port}`; clearTimeout(timer); resolve(); }
    });
  });
  const response = await fetch(`${api}/health`, { headers: { 'X-Stroke-Token': token } });
  if (!response.ok || !(await response.json()).modelReady) throw Error('O modelo de análise não está disponível.');
}
async function stop() {
  quitting = true;
  await writeQueue.catch(() => {});
  if (analyzer && analyzer.exitCode === null) {
    analyzer.stdin.end();
    await Promise.race([new Promise(resolve => analyzer.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 7000))]);
    if (analyzer.exitCode === null) analyzer.kill();
  }
  server?.close(); app.exit();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); win ? win.close() : void stop(); } });
  app.on('window-all-closed', () => { if (!quitting) void stop(); });
  app.whenReady().then(async () => {
    await fsp.mkdir(data(), { recursive: true });
    if (smoke) await fsp.rm(recoveryPath(), { force: true });
    if (fs.existsSync(logPath()) && fs.statSync(logPath()).size > 2 * 1024 ** 2) await fsp.rename(logPath(), logPath() + '.previous').catch(() => {});
    log(`Stroke ${app.getVersion()} ${process.platform} ${process.arch}`);
    win = new BrowserWindow({ width: 1440, height: 940, minWidth: 900, minHeight: 650, backgroundColor: '#131311', title: `Stroke ${app.getVersion()}`, icon: path.join(__dirname, 'icon.png'), show: !smoke, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => { if (url !== origin + '/') event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    win.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      if (dirty && dialog.showMessageBoxSync(win, { type: 'question', title: 'Fechar o Stroke?', message: 'Tens alterações por guardar.', detail: 'Volta ao editor para guardar. A cópia de recuperação fica disponível na próxima abertura.', buttons: ['Voltar ao editor', 'Fechar'], defaultId: 0, cancelId: 0 }) !== 1) return;
      void stop();
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Stroke', submenu: [{ label: `Versão ${app.getVersion()}`, enabled: false }, { type: 'separator' }, { label: 'Sair', click: () => win.close() }] },
      { label: 'Editar', submenu: [{ role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
      { label: 'Ver', submenu: [{ role: 'resetZoom', label: 'Tamanho original' }, { role: 'zoomIn', label: 'Ampliar' }, { role: 'zoomOut', label: 'Reduzir' }, { role: 'togglefullscreen', label: 'Ecrã inteiro' }] },
      { label: 'Ajuda', submenu: [{ label: 'Exportar diagnóstico…', click: async () => { const result = await dialog.showSaveDialog(win, { defaultPath: `Stroke-${app.getVersion()}-diagnostico.txt` }); if (!result.canceled) await fsp.copyFile(logPath(), result.filePath).catch(err => dialog.showErrorBox('Stroke', err.message)); } }] },
    ]));
    await win.loadFile(path.join(__dirname, 'loading.html'));
    try {
      await startServer(); await startAnalyzer(); installIPC(); await win.loadURL(origin);
      if (smoke) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const result = await win.webContents.executeJavaScript(`({ title: document.title, text: document.body.innerText, bridge: !!window.strokeDesktop })`);
        if (!result.bridge || !result.text.includes('Abrir projeto')) throw Error('Desktop renderer smoke test failed.');
        const checks = await require('./smoke.cjs')({ win, dialog, api, token, data: data() });
        await fsp.writeFile(path.join(data(), 'smoke-result.json'), JSON.stringify({ ok: true, version: app.getVersion(), checks, ...result }));
        await win.webContents.capturePage().then(img => fsp.writeFile(path.join(data(), 'smoke.png'), img.toPNG()));
        await stop();
      }
    } catch (err) {
      log(err.stack || err.message);
      if (smoke) {
        await fsp.writeFile(path.join(data(), 'smoke-failure.txt'), await win.webContents.executeJavaScript('document.body.innerText').catch(() => 'Renderer unavailable'));
      }
      if (smoke) await fsp.writeFile(path.join(data(), 'smoke-result.json'), JSON.stringify({ ok: false, error: err.message }));
      else dialog.showErrorBox('Não foi possível abrir o Stroke', `${err.message}\n\nDiagnóstico: ${logPath()}`);
      await stop();
    }
  });
}
