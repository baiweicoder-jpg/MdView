const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDocument } = require('./markdown.cjs');

const smoke = process.argv.includes('--smoke-test');
const portableDirectory = app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR;
if (portableDirectory) {
  const dataDirectory = path.join(portableDirectory, 'MdView-data');
  try { require('node:fs').mkdirSync(dataDirectory, { recursive: true }); }
  catch {
    dialog.showErrorBox('无法启动便携版', '请将便携版放在可写目录中运行，偏好设置保存在旁边的 MdView-data 文件夹。');
    app.exit(1);
  }
  app.setPath('userData', dataDirectory);
}
if (smoke) {
  if (!portableDirectory) app.setPath('userData', path.join(app.getPath('temp'), `mdview-smoke-${process.pid}`));
  app.disableHardwareAcceleration();
}
let win;
let editSession;
let requestNumber = 0;
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
const welcome = path.join(__dirname, '..', 'examples', '欢迎使用.md');

async function openDocument(file, remember = true) {
  return loadDocument(file, remember);
}
async function loadDocument(file, remember = true, reload = false) {
  const request = ++requestNumber;
  try {
    const document = await readDocument(file);
    if (request !== requestNumber) return;
    editSession.openDocument(document, reload);
    if (remember && !smoke) app.addRecentDocument(file);
    return document;
  } catch (error) {
    if (request === requestNumber) win.webContents.send('document', { ok: false, message: error.code === 'ENOENT' ? '文件不存在或已被移动。' : error.code === 'EACCES' ? '无法读取此文件，请检查权限。' : error.message });
    return null;
  }
}

async function reloadDocument() {
  const file = editSession.file;
  if (!file) { newDocument(); return; }
  if (!(await editSession.confirmLeaveActive())) return;
  return loadDocument(file, false, true);
}

async function chooseDocument() {
  const result = await dialog.showOpenDialog(win, { title: '打开 Markdown', properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
  if (!result.canceled) await openDocument(result.filePaths[0]);
}

function newDocument() {
  editSession.newBlank();
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
  const getSettings = await require('./settings.cjs')(win, trusted);
  editSession = require('./edit-session.cjs')(win, trusted, welcome, getSettings);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  ipcMain.handle('open', event => { trusted(event); return chooseDocument(); });
  ipcMain.handle('new-document', event => { trusted(event); return newDocument(); });
  ipcMain.handle('drop', (event, file) => { trusted(event); return openDocument(file); });
  ipcMain.handle('reload-document', event => { trusted(event); return reloadDocument(); });
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
      { label: '新建空白文档', accelerator: 'Ctrl+N', click: newDocument },
      { label: '打开 Markdown…', accelerator: 'Ctrl+O', click: chooseDocument },
      { label: '重新读取', accelerator: 'Ctrl+R', click: () => reloadDocument() },
      { label: '保存', accelerator: 'Ctrl+S', click: () => win.webContents.send('save-request', false) },
      { label: '另存为', accelerator: 'Ctrl+Shift+S', click: () => win.webContents.send('save-request', true) },
      { label: '编辑 / 阅读', accelerator: 'Ctrl+E', click: () => win.webContents.send('toggle-edit') },
      { type: 'separator' },
      { label: '下一个标签', accelerator: 'Ctrl+Tab', click: () => win.webContents.send('next-tab-request') },
      { label: '上一个标签', accelerator: 'Ctrl+Shift+Tab', click: () => win.webContents.send('previous-tab-request') },
      { label: '关闭标签', accelerator: 'Ctrl+W', click: () => win.webContents.send('close-tab-request') },
      { type: 'separator' }, { label: '退出', role: 'quit' }
    ] },
    { label: '查看', submenu: [
      { label: '切换目录', accelerator: 'Ctrl+Shift+B', click: () => win.webContents.send('toggle-outline') },
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
      await require('../test/editor-smoke.cjs')({ win, openDocument, app });
      await require('../test/tabs-smoke.cjs')({ win, openDocument, app });
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
