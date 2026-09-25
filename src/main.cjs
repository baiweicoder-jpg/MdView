const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDocument } = require('./markdown.cjs');

const smoke = process.argv.includes('--smoke-test');
if (smoke) {
  app.setPath('userData', path.join(app.getPath('temp'), `mdview-smoke-${process.pid}`));
  app.disableHardwareAcceleration();
}
let win;
let currentFile;
let requestNumber = 0;
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
const welcome = path.join(__dirname, '..', 'examples', '欢迎使用.md');

async function openDocument(file, remember = true) {
  const request = ++requestNumber;
  try {
    const document = await readDocument(file);
    if (request !== requestNumber) return;
    currentFile = file;
    win.setTitle(`${document.name} — MdView`);
    win.webContents.send('document', { ok: true, document });
    if (remember && !smoke) app.addRecentDocument(file);
    return document;
  } catch (error) {
    if (request === requestNumber) win.webContents.send('document', { ok: false, message: error.code === 'ENOENT' ? '文件不存在或已被移动。' : error.code === 'EACCES' ? '无法读取此文件，请检查权限。' : error.message });
    return null;
  }
}

async function chooseDocument() {
  const result = await dialog.showOpenDialog(win, { title: '打开 Markdown', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
  if (!result.canceled) await openDocument(result.filePaths[0]);
}

function trusted(event) {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('拒绝未授权请求。');
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({
    width: 1220, height: 860, minWidth: 760, minHeight: 520,
    icon: path.join(__dirname, 'assets', 'mdview.png'),
    backgroundColor: '#f6f7f9', show: !smoke,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, offscreen: smoke }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  ipcMain.handle('open', event => { trusted(event); return chooseDocument(); });
  ipcMain.handle('drop', (event, file) => { trusted(event); return openDocument(file); });
  ipcMain.handle('reload-document', event => { trusted(event); return openDocument(currentFile || welcome, false); });
  ipcMain.handle('external', async (event, href) => {
    trusted(event);
    if (typeof href !== 'string' || href.length > 8192) return;
    const url = new URL(href);
    if (url.protocol === 'https:' || url.protocol === 'http:') await shell.openExternal(url.href);
  });
  ipcMain.handle('copy', (event, text) => {
    trusted(event);
    if (typeof text === 'string' && text.length <= 10 * 1024 * 1024) require('electron').clipboard.writeText(text);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [
      { label: '打开 Markdown…', accelerator: 'Ctrl+O', click: chooseDocument },
      { label: '重新读取', accelerator: 'Ctrl+R', click: () => openDocument(currentFile || welcome, false) },
      { type: 'separator' }, { label: '退出', role: 'quit' }
    ] },
    { label: '查看', submenu: [
      { label: '切换目录', accelerator: 'Ctrl+B', click: () => win.webContents.send('toggle-outline') },
      { label: '全屏', role: 'togglefullscreen' }, { type: 'separator' },
      { label: '放大界面', role: 'zoomIn' }, { label: '缩小界面', role: 'zoomOut' }, { label: '重置缩放', role: 'resetZoom' }
    ] }
  ]));
  await win.loadFile(path.join(__dirname, 'index.html'));
  const initialFile = process.argv.slice(app.isPackaged ? 1 : 2).find(arg => /\.(md|markdown)$/i.test(arg));
  await openDocument(initialFile || welcome, false);
  if (smoke) {
    try {
      await require('../test/desktop-smoke.cjs')({ win, openDocument, app });
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
