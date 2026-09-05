// Rasterize the existing SVG favicon for Windows; no new artwork is generated.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 256, height: 256, show: false, frame: false, transparent: true });
  const svg = fs.readFileSync(path.join(__dirname, '../app/public/favicon.svg'), 'utf8').replace('width="24" height="24"', 'width="256" height="256"');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0">${svg}</body>`));
  await new Promise(resolve => setTimeout(resolve, 1500));
  fs.writeFileSync(path.join(__dirname, 'icon.png'), (await win.webContents.capturePage()).toPNG());
  app.quit();
});
