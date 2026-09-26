const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { registerImagePaste } = require('../src/image-paste.cjs');
// An isolated profile avoids contending with an already running desktop app.
const profileRoot = process.env.TMPDIR || app.getPath('userData');
require('node:fs').mkdirSync(profileRoot, { recursive: true });
app.setPath('userData', require('node:fs').mkdtempSync(path.join(profileRoot, 'paste-profile-')));
app.whenReady().then(async () => {
  let win;
  try {
    const dir = await fs.mkdtemp(path.join(app.getPath('userData'), 'mdview-paste-'));
    const preload = path.join(dir, 'preload.cjs');
    await fs.writeFile(preload, "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('mdview',{pasteImage:bytes=>ipcRenderer.invoke('paste-image',bytes)});");
    const html = path.join(dir, 'index.html');
    await fs.writeFile(html, '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; img-src data:; style-src \'self\'"> <link rel="stylesheet" href="style.css"></head><body><script src="editor.js"></script></body></html>');
    await fs.copyFile(path.join(__dirname, '../src/generated/rich-editor.js'), path.join(dir, 'editor.js'));
    await fs.copyFile(path.join(__dirname, '../src/style.css'), path.join(dir, 'style.css'));
    win = new BrowserWindow({ width: 800, height: 600, show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    registerImagePaste(event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame);
    win.webContents.on('console-message', event => console.log('Renderer:', event.message));
    await win.loadFile(html);
    // Match the production renderer's navigation guard for drops outside editors.
    await win.webContents.executeJavaScript("for(const type of ['dragover','drop']) document.addEventListener(type,event=>event.preventDefault())");
    if (process.argv.includes('--move-only')) await require('./image-move-smoke.cjs')({ win, outputDirectory: dir });
    else if (process.argv.includes('--layout-only')) await require('./image-layout-smoke.cjs')({ win, outputDirectory: dir });
    else await require('./image-paste-smoke.cjs')({ win, app, outputDirectory: dir });
    console.log(`Image paste artifact: ${dir}`);
    win.destroy(); app.exit(0);
  } catch(error) { console.error(error); win?.destroy(); app.exit(1); }
});
