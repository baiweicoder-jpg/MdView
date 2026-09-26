const { app, BrowserWindow, dialog, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readDocument } = require('./markdown.cjs');
const { english, translate } = require('./i18n.cjs');
let uiLanguage = 'zh-CN';
const t = text => translate(text, uiLanguage);

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
  const result = await dialog.showOpenDialog(win, { title: t('打开 Markdown'), properties: ['openFile'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
  if (!result.canceled) await openDocument(result.filePaths[0]);
}

function newDocument() {
  editSession.newBlank();
}

function trusted(event) {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== page) throw new Error('拒绝未授权请求。');
}

module.exports = app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  win = new BrowserWindow({
    width: 1220, height: 860, minWidth: 760, minHeight: 520,
    icon: path.join(__dirname, 'assets', 'mdview.png'),
    backgroundColor: '#f6f7f9', show: !smoke,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, offscreen: smoke }
  });
  const getSettings = await require('./settings.cjs')(win, trusted, language => { uiLanguage = language; buildMenu(); editSession?.refreshTitle(); });
  uiLanguage = getSettings().language;
  ipcMain.handle('get-i18n', event => { trusted(event); return { language: uiLanguage, english }; });
  const { createSessionStore, restoreWorkspace } = require('./workspace-session.cjs');
  const sessionStore = createSessionStore(path.join(app.getPath('userData'), 'session.json'));
  const savedWorkspace = sessionStore.load();
  let workspaceReady = false;
  editSession = require('./edit-session.cjs')(win, trusted, welcome, getSettings, state => { if (workspaceReady) sessionStore.save(state); });
  // Flush synchronously after close is accepted, including destroy() after a discard prompt.
  win.on('closed', () => sessionStore.flush());
  app.on('will-quit', () => sessionStore.flush());
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
  const menuState = {};
  function localizeMenu(items) {
    return items.map(item => ({ ...item, ...(item.label ? { label: t(item.label) } : {}), ...(Array.isArray(item.submenu) ? { submenu: localizeMenu(item.submenu) } : {}) }));
  }
  function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(localizeMenu([
    { label: '文件', submenu: [
      { label: '新建空白文档', accelerator: 'Ctrl+N', click: newDocument },
      { label: '打开 Markdown…', accelerator: 'Ctrl+O', click: chooseDocument },
      { label: '重新读取', accelerator: 'Ctrl+R', click: () => reloadDocument() },
      { label: '保存', accelerator: 'Ctrl+S', click: () => win.webContents.send('save-request', false) },
      { label: '另存为', accelerator: 'Ctrl+Shift+S', click: () => win.webContents.send('save-request', true) },

      { type: 'separator' },
      { label: '下一个标签', accelerator: 'Ctrl+Tab', click: () => win.webContents.send('next-tab-request') },
      { label: '上一个标签', accelerator: 'Ctrl+Shift+Tab', click: () => win.webContents.send('previous-tab-request') },
      { label: '关闭标签', accelerator: 'Ctrl+W', click: () => win.webContents.send('close-tab-request') },
      { type: 'separator' }, { label: '退出', role: 'quit' }
    ] },
    { label: '编辑', submenu: [
      { id: 'edit-mode', label: '编辑模式', type: 'checkbox', accelerator: 'Ctrl+E', click: () => win.webContents.send('toggle-edit') }
    ] },
    { label: '查看', submenu: [
      { label: '主题', submenu: ['system', 'light', 'dark', 'warm'].map((theme, index) => ({
        id: `theme-${theme}`, label: ['跟随系统', '浅色', '深色', '暖纸'][index], type: 'radio',
        click: () => win.webContents.send('menu-action', 'theme', theme)
      })) },
      { id: 'font-up', label: '增大正文字号', click: () => win.webContents.send('menu-action', 'font', 1) },
      { id: 'font-down', label: '减小正文字号', click: () => win.webContents.send('menu-action', 'font', -1) },
      { label: '重置正文字号', click: () => win.webContents.send('menu-action', 'font-reset') },
      { type: 'separator' },
      { label: '切换目录', accelerator: 'Ctrl+Shift+B', click: () => win.webContents.send('toggle-outline') },
      { label: '全屏', role: 'togglefullscreen' }, { type: 'separator' },
      { label: '放大界面', role: 'zoomIn' }, { label: '缩小界面', role: 'zoomOut' }, { label: '重置缩放', role: 'resetZoom' }
    ] },
    { label: '设置', submenu: [
      { label: '偏好设置…', accelerator: 'Ctrl+,', click: () => win.webContents.send('menu-action', 'settings') },
      { label: '界面语言', submenu: [
        { id: 'language-zh-CN', label: '简体中文', type: 'radio', checked: uiLanguage === 'zh-CN', click: () => win.webContents.send('menu-action', 'language', 'zh-CN') },
        { id: 'language-en', label: 'English', type: 'radio', checked: uiLanguage === 'en', click: () => win.webContents.send('menu-action', 'language', 'en') }
      ] }
    ] }
  ])));
  // Keep accelerator registration, but never show a duplicate native menu row.
  win.setAutoHideMenuBar(false);
  win.setMenuBarVisibility(false);
  syncMenuState(menuState);
  }
  function syncMenuState(state) {
    const menu = Menu.getApplicationMenu();
    if (['system', 'light', 'dark', 'warm'].includes(state.theme)) menu.getMenuItemById(`theme-${state.theme}`).checked = true;
    if (Number.isInteger(state.fontSize)) {
      menu.getMenuItemById('font-up').enabled = state.fontSize < 24;
      menu.getMenuItemById('font-down').enabled = state.fontSize > 13;
    }
    if (typeof state.editing === 'boolean') menu.getMenuItemById('edit-mode').checked = state.editing;
  }
  buildMenu();
  const quickActions = {
    edit: () => win.webContents.send('toggle-edit'),
    save: () => win.webContents.send('save-request', false),
    open: chooseDocument, new: newDocument,
    outline: () => win.webContents.send('toggle-outline'),
    settings: () => win.webContents.send('menu-action', 'settings'),
    reload: reloadDocument
  };
  ipcMain.handle('quick-action', (event, action) => {
    trusted(event);
    if (!Object.hasOwn(quickActions, action)) throw Error('Unknown quick action');
    return quickActions[action]();
  });
  ipcMain.handle('get-menu-bar', event => {
    trusted(event);
    return { menus: Menu.getApplicationMenu().items.map((item, index) => ({ index, label: item.label })), state: menuState };
  });
  ipcMain.handle('popup-menu', (event, index, point) => {
    trusted(event);
    const menus = Menu.getApplicationMenu().items;
    if (!Number.isInteger(index) || index < 0 || index >= menus.length || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw Error('Invalid menu request');
    const zoom = win.webContents.getZoomFactor();
    const [width, height] = win.getContentSize();
    const x = Math.round(Math.max(0, Math.min(width, point.x * zoom)));
    const y = Math.round(Math.max(0, Math.min(height, point.y * zoom)));
    return new Promise(resolve => menus[index].submenu.popup({ window: win, x, y, callback: () => resolve(true) }));
  });
  let altAlone = false;
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Alt') {
      event.preventDefault();
      if (input.type === 'keyDown') altAlone = !input.isAutoRepeat;
      else if (input.type === 'keyUp' && altAlone) { altAlone = false; win.webContents.send('activate-menu-bar'); }
    } else if (input.type === 'keyDown') {
      altAlone = false;
      if (input.key === 'F10' && !input.shift && !input.control && !input.alt) { event.preventDefault(); win.webContents.send('activate-menu-bar'); }
      const index = ['f', 'e', 'v', 's'].indexOf(input.key.toLowerCase());
      if (input.alt && !input.control && index >= 0) { event.preventDefault(); win.webContents.send('activate-menu-bar', index); }
    }
  });
  ipcMain.on('menu-state', (event, state) => {
    trusted(event);
    if (!state || typeof state !== 'object') return;
    Object.assign(menuState, state);
    syncMenuState(state);
    win.webContents.send('menu-state-changed', menuState);
  });
  const initialFile = process.argv.slice(app.isPackaged ? 1 : 2).find(arg => /\.(md|markdown)$/i.test(arg));
  const workspace = await restoreWorkspace(savedWorkspace, initialFile, readDocument);
  if (!workspace.documents.length) {
    try { workspace.documents.push(await readDocument(welcome)); }
    catch { workspace.documents.push({ path: '', viewState: { editing: true, scrollTop: 0 } }); }
  }
  editSession.restore(workspace);
  await win.loadFile(path.join(__dirname, 'index.html'));
  workspaceReady = true;
  editSession.present();
  if (smoke) {
    try {
      await require('../test/desktop-smoke.cjs')({ win, openDocument, app });
      await require('../test/editor-smoke.cjs')({ win, openDocument, app });
      await require('../test/tabs-smoke.cjs')({ win, openDocument, app });
      await require('../test/code-edit-smoke.cjs')({ win, openDocument, app });
      await require('../test/markdown-edit-smoke.cjs')({ win, openDocument, app });
      await require('../test/i18n-smoke.cjs')({ win, openDocument, app });
      await require('../test/colors-smoke.cjs')({ win, openDocument, app });
      await require('../test/menu-bar-smoke.cjs')({ win, openDocument, app });
      await require('../test/sidebar-smoke.cjs')({ win, openDocument, app });
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  }
  return { win, editSession, openDocument, sessionStore };
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
