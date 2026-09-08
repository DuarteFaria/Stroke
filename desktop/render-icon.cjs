// Rasterize the existing SVG favicon at macOS installer resolution.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true });
  const svg = fs.readFileSync(path.join(__dirname, '../app/public/favicon.svg'), 'utf8').replace('width="24" height="24"', 'width="1024" height="1024"');
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0">${svg}</body>`));
  await new Promise(resolve => setTimeout(resolve, 1500));
  fs.writeFileSync(path.join(__dirname, 'icon.png'), (await win.webContents.capturePage()).toPNG());
  app.quit();
});
