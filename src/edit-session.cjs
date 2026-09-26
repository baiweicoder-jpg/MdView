const path = require('node:path');
const { dialog, ipcMain } = require('electron');
const { saveTextFile, readTextFile, MAX_DOCUMENT } = require('./document-file.cjs');
const { renderMarkdown, renderEditorHtml } = require('./markdown.cjs');
const { translate } = require('./i18n.cjs');
const { viewState, pathKey, MAX_TABS } = require('./workspace-session.cjs');

module.exports = function editingSession(win, trusted, welcome, getSettings, persist = () => {}) {
  const t = key => translate(key, getSettings().language);
  const displayName = tab => tab.document.path ? tab.document.name : t('未命名.md');
  const tabs = [];
  let active = null;
  let busy = false;
  let sequence = 0;
  const send = (channel, data) => { if (!win.isDestroyed()) win.webContents.send(channel, data); };

  const summary = () => tabs.map(tab => ({ id: tab.id, name: tab.document.name, path: tab.document.path, dirty: tab.dirty, active: tab === active }));
  const refreshTitle = () => win.setTitle(`${active?.dirty ? '● ' : ''}${active ? displayName(active) : 'MdView'} — MdView`);
  const snapshot = () => ({ version: 1, tabs: tabs.slice(0, MAX_TABS).map(tab => ({ path: tab.document.path, viewState: tab.viewState })), activeIndex: Math.max(0, tabs.indexOf(active)) });
  const pushTabs = () => { refreshTitle(); send('tabs', summary()); persist(snapshot()); };
  const documentPayload = tab => ({ ...tab.document, source: tab.source, editorHtml: renderEditorHtml(tab.source), id: tab.id, viewState: { ...tab.viewState } });
  const findById = id => tabs.find(tab => tab.id === id);

  function setActive(tab, { edit = tab.viewState.editing, notify = true } = {}) {
    active = tab;
    pushTabs();
    if (notify) send('document', { ok: true, document: documentPayload(tab), edit });
  }

  function openDocument(document, reload = false) {
    if (!document || !document.path) return;
    const existing = tabs.find(tab => tab.document.path && pathKey(tab.document.path) === pathKey(document.path));
    if (existing) {
      if (reload) { existing.document = document; existing.source = document.source; existing.dirty = false; }
      if (reload || existing !== active) setActive(existing);
      return;
    }
    tabs.push({ id: ++sequence, document, source: document.source, dirty: false, viewState: viewState(document.viewState) });
    setActive(tabs[tabs.length - 1]);
  }

  function newBlank() {
    const document = { path: '', name: '未命名.md', source: '', html: '', editorHtml: '', headings: [], warnings: [], characters: 0, fingerprint: null, bom: false, newline: '\n' };
    tabs.push({ id: ++sequence, document, source: '', dirty: false, viewState: viewState({ editing: true }) });
    setActive(tabs[tabs.length - 1], { edit: true });
  }

  function updateSource(id, source) {
    const tab = findById(id);
    if (!tab || typeof source !== 'string' || Buffer.byteLength(source) > MAX_DOCUMENT) throw Error('文档已切换或内容超过 10 MB。');
    tab.source = source;
    tab.dirty = source !== tab.document.source;
    pushTabs();
  }

  function switchTab(id, source) {
    if (active && typeof source === 'string') updateSource(active.id, source);
    const tab = findById(id);
    if (!tab) throw Error('文档不存在。');
    setActive(tab, { notify: false });
    return { ok: true, document: documentPayload(tab), edit: tab.viewState.editing };
  }

  async function saveTab(tab, asNew) {
    const snapshot = tab.source;
    let target = tab.document.path, expectedHash = tab.document.fingerprint;
    if (asNew || !target || target === welcome) {
      const name = !target ? displayName(tab) : target === welcome ? t('我的文档.md') : path.basename(target);
      const result = await dialog.showSaveDialog(win, { title: t('保存 Markdown'), defaultPath: path.join(getSettings().saveDirectory, name), filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled) return { ok: false, canceled: true };
      target = result.filePath;
      if (target === welcome) throw Error('请另选位置保存，保留内置欢迎文档。');
      if (target !== tab.document.path) {
        try { expectedHash = (await readTextFile(target)).fingerprint; }
        catch (error) { if (error.code !== 'ENOENT') throw error; expectedHash = null; }
      }
    } else if (!tab.dirty) return { ok: true };
    const saved = await saveTextFile(target, snapshot, { expectedHash, bom: tab.document.bom, newline: tab.document.newline });
    tab.document = { ...tab.document, ...saved, name: path.basename(target) };
    tab.dirty = tab.source !== snapshot;
    if (!tab.dirty) tab.source = saved.source;
    pushTabs();
    send('saved', { ...saved, id: tab.id, name: tab.document.name, snapshot, dirty: tab.dirty });
    return { ok: true };
  }

  async function exclusive(action) {
    if (busy) return { ok: false, message: '文件正在处理中，请稍候。' };
    busy = true; send('file-busy', true);
    try { return await action(); }
    catch (error) { return { ok: false, message: error.message }; }
    finally { busy = false; send('file-busy', false); }
  }

  async function confirmDirty(tab) {
    if (!tab.dirty) return true;
    const { response } = await dialog.showMessageBox(win, { type: 'question', message: t('「{name}」有未保存的修改').replace('{name}', displayName(tab)), buttons: ['保存', '不保存', '取消'].map(t), defaultId: 2, cancelId: 2 });
    if (response === 2) return false;
    if (response === 1) return true;
    return (await saveTab(tab, false)).ok && !tab.dirty;
  }

  async function closeTab(id, source) {
    return exclusive(async () => {
      if (active && typeof source === 'string') updateSource(active.id, source);
      const index = tabs.findIndex(tab => tab.id === id);
      if (index < 0) return { ok: true };
      const tab = tabs[index];
      if (!(await confirmDirty(tab))) return { ok: false, canceled: true };
      tabs.splice(index, 1);
      if (tab === active) {
        const next = tabs[Math.min(index, tabs.length - 1)];
        if (next) setActive(next);
        else { active = null; pushTabs(); send('document', { ok: false, message: '没有打开的文档' }); }
      } else pushTabs();
      return { ok: true };
    });
  }

  async function confirmAllLeave() {
    for (const tab of tabs) if (!(await confirmDirty(tab))) return false;
    return true;
  }

  async function confirmLeaveActive() {
    if (!active || !active.dirty) return true;
    return confirmDirty(active);
  }

  ipcMain.on('workspace-view', (event, payload) => {
    trusted(event);
    const tab = findById(payload?.id);
    if (!tab) return;
    tab.viewState = viewState(payload);
    persist(snapshot());
  });
  ipcMain.on('draft', (event, payload) => { trusted(event); try { updateSource(payload.id, payload.source); } catch (error) { send('edit-error', error.message); } });
  ipcMain.handle('save', (event, payload) => { trusted(event); return exclusive(async () => { updateSource(payload.id, payload.source); return saveTab(active, payload.asNew); }); });
  ipcMain.handle('switch-tab', (event, payload) => { trusted(event); return exclusive(() => switchTab(payload.id, payload.source)); });
  ipcMain.handle('close-tab', (event, payload) => { trusted(event); return closeTab(payload.id, payload.source); });
  ipcMain.handle('preview', async (event, payload) => {
    trusted(event);
    const tab = findById(payload.id);
    if (!tab || typeof payload.source !== 'string' || Buffer.byteLength(payload.source) > MAX_DOCUMENT) throw Error('无效文档');
    const current = tab.document;
    return { ...current, ...await renderMarkdown(payload.source, current.path ? path.dirname(current.path) : getSettings().saveDirectory), source: payload.source, characters: payload.source.length, id: payload.id };
  });
  win.on('close', event => {
    if (busy) { event.preventDefault(); return; }
    if (tabs.some(tab => tab.dirty)) {
      event.preventDefault();
      exclusive(async () => { if (await confirmAllLeave()) { for (const tab of tabs) tab.dirty = false; win.destroy(); } });
    }
  });
  win.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', message: t('放弃未保存的修改并重新加载界面？'), buttons: ['取消', '放弃修改'].map(t), defaultId: 0, cancelId: 0 });
    if (response === 1) { if (active) active.dirty = false; event.preventDefault(); }
  });
  return {
    snapshot,
    restore(workspace) {
      // Hydrate without intermediate document events: renderer sees only the final active tab.
      for (const document of workspace.documents) {
        const blank = { path: '', name: '未命名.md', source: '', html: '', editorHtml: '', headings: [], warnings: [], characters: 0, fingerprint: null, bom: false, newline: '\n' };
        const restored = document.path ? document : { ...blank, viewState: document.viewState };
        tabs.push({ id: ++sequence, document: restored, source: restored.source, dirty: false, viewState: viewState(document.viewState) });
      }
      active = tabs[workspace.activeIndex] || tabs[0] || null;
    },
    present() { if (active) setActive(active); },
    get file() { return active?.document.path; },
    refreshTitle,
    openDocument,
    newBlank,
    confirmLeaveActive,
    switchTab,
    closeTab,
    saveTab,
  };
};
