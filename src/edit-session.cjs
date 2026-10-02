const path = require('node:path');
const { dialog, ipcMain, Menu, clipboard, shell } = require('electron');
const fs = require('node:fs/promises');
const { saveTextFile, readTextFile, MAX_DOCUMENT } = require('./document-file.cjs');
const { renderMarkdown, renderEditorHtml } = require('./markdown.cjs');
const { translate } = require('./i18n.cjs');
const { viewState, pathKey, MAX_TABS } = require('./workspace-session.cjs');

module.exports = function editingSession(win, trusted, welcome, getSettings, persist = () => {}, commit = () => false) {
  const t = key => translate(key, getSettings().language);
  const askUnsaved = require('./confirm-dialog.cjs')(win, trusted);
  const displayName = tab => tab.document.path ? tab.document.name : t('未命名.md');
  const tabs = [];
  let active = null;
  let busy = false;
  let renaming = false;
  let sequence = 0;
  const send = (channel, data) => { if (!win.isDestroyed()) win.webContents.send(channel, data); };

  const summary = () => tabs.map(tab => ({ id: tab.id, name: tab.document.name, path: tab.document.path, dirty: tab.dirty, active: tab === active }));
  const refreshTitle = () => win.setTitle(`${active?.dirty ? '● ' : ''}${active ? displayName(active) : 'MdView'} — MdView`);
  const snapshot = () => ({ version: 2, tabs: tabs.map(tab => ({ path: tab.document.path, viewState: tab.viewState, ...(!tab.document.path ? { source: tab.source, createdAt: tab.document.createdAt, updatedAt: tab.document.updatedAt } : {}) })), activeIndex: Math.max(0, tabs.indexOf(active)) });
  const pushTabs = () => { refreshTitle(); send('tabs', summary()); persist(snapshot()); };
  const documentPayload = tab => ({ ...tab.document, ...(tab.preview?.source === tab.source ? tab.preview : {}), source: tab.source, editorHtml: renderEditorHtml(tab.source), id: tab.id, viewState: { ...tab.viewState } });
  const findById = id => tabs.find(tab => tab.id === id);

  function setActive(tab, { edit = tab.viewState.editing, notify = true } = {}) {
    active = tab;
    pushTabs();
    if (notify) send('document', { ok: true, document: documentPayload(tab), edit });
  }

  function openDocument(document, reload = false) {
    if (busy) return;
    return acceptDocument(document, reload);
  }

  function acceptDocument(document, reload = false, notify = true) {
    if (!document || !document.path) return;
    const existing = tabs.find(tab => tab.document.path && pathKey(tab.document.path) === pathKey(document.path));
    if (existing) {
      if (reload) { existing.document = document; existing.source = document.source; existing.dirty = false; existing.preview = null; }
      if (reload || existing !== active) setActive(existing, { notify });
      return existing;
    }
    if (tabs.length >= MAX_TABS) {
      const message = t('最多打开 100 个标签。请先关闭一个标签。');
      if (!notify) throw Error(message);
      send('edit-error', message); return;
    }
    tabs.push({ id: ++sequence, document, source: document.source, dirty: false, viewState: viewState(document.viewState) });
    setActive(tabs[tabs.length - 1], { notify });
    return active;
  }

  function newBlank() {
    if (busy) return;
    if (tabs.length >= MAX_TABS) { send('edit-error', '最多打开 100 个标签。请先关闭一个标签。'); return; }
    const now = Date.now();
    const document = { createdAt: now, updatedAt: now, path: '', name: '未命名.md', source: '', html: '', editorHtml: '', headings: [], warnings: [], characters: 0, fingerprint: null, bom: false, newline: '\n' };
    tabs.push({ id: ++sequence, document, source: '', dirty: false, viewState: viewState({ editing: true }) });
    setActive(tabs[tabs.length - 1], { edit: true });
  }

  function updateSource(id, source) {
    const tab = findById(id);
    if (!tab || typeof source !== 'string' || Buffer.byteLength(source) > MAX_DOCUMENT) throw Error('文档已切换或内容超过 10 MB。');
    if (tab.source !== source) {
      tab.preview = null;
      if (!tab.document.path) {
        tab.document.updatedAt = Date.now();
        send('document-times', { id: tab.id, createdAt: tab.document.createdAt, updatedAt: tab.document.updatedAt });
      }
    }
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
    const savedSource = tab.source;
    let target = tab.document.path, expectedHash = tab.document.fingerprint;
    if (asNew || !target || target === welcome) {
      const name = !target ? displayName(tab) : target === welcome ? t('我的文档.md') : path.basename(target);
      const result = await dialog.showSaveDialog(win, { title: t('保存 Markdown'), defaultPath: path.join(getSettings().saveDirectory, name), filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled) return { ok: false, canceled: true };
      target = result.filePath;
      if (tabs.some(other => other !== tab && other.document.path && pathKey(other.document.path) === pathKey(target))) {
        throw Error('目标文件已在其他标签中打开，请另选保存位置。');
      }
      if (target === welcome) throw Error('请另选位置保存，保留内置欢迎文档。');
      if (target !== tab.document.path) {
        try { expectedHash = (await readTextFile(target)).fingerprint; }
        catch (error) { if (error.code !== 'ENOENT') throw error; expectedHash = null; }
      }
    } else if (!tab.dirty) return { ok: true };
    const saved = await saveTextFile(target, savedSource, { expectedHash, bom: tab.document.bom, newline: tab.document.newline });
    tab.document = { ...tab.document, ...saved, name: path.basename(target) };
    tab.dirty = tab.source !== savedSource;
    if (!tab.dirty) tab.source = saved.source;
    pushTabs();
    send('saved', { ...saved, id: tab.id, name: tab.document.name, snapshot: savedSource, dirty: tab.dirty });
    if (!commit(snapshot())) throw Error('文档已保存，但无法更新草稿恢复数据。请在退出前重试。');
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
    const response = await askUnsaved({ name: displayName(tab), language: getSettings().language });
    if (response === 'cancel') return false;
    if (response === 'discard') return true;
    return (await saveTab(tab, false)).ok && !tab.dirty;
  }

  async function closeTab(id, source) {
    return exclusive(async () => {
      if (active && typeof source === 'string') updateSource(active.id, source);
      return closeOne(id);
    });
  }

  async function closeOne(id) {
      const index = tabs.findIndex(tab => tab.id === id);
      if (index < 0) return { ok: true };
      const tab = tabs[index];
      if (!(await confirmDirty(tab))) return { ok: false, canceled: true };
      const previousActive = active;
      tabs.splice(index, 1);
      if (tab === active) active = tabs[Math.min(index, tabs.length - 1)] || null;
      if (!commit(snapshot())) {
        tabs.splice(index, 0, tab); active = previousActive;
        persist(snapshot());
        throw Error('无法更新草稿恢复数据，标签未关闭。');
      }
      if (tab === previousActive) {
        const next = tabs[Math.min(index, tabs.length - 1)];
        if (next) setActive(next);
        else { active = null; pushTabs(); send('document', { ok: true, empty: true }); }
      } else pushTabs();
      return { ok: true };
  }

  ipcMain.handle('batch-tabs', (event, request) => {
    trusted(event);
    if (!request || !['close', 'trash'].includes(request.action) || !Array.isArray(request.ids) || !request.ids.length || request.ids.length > MAX_TABS || request.ids.some(id => !Number.isInteger(id))) throw Error('Invalid batch action');
    const ids = [...new Set(request.ids)];
    for (const id of ids) requireTab(id);
    return exclusive(async () => {
      const latest = await win.webContents.executeJavaScript('window.mdviewPrepareClose()');
      if (active) {
        if (!latest || latest.id !== active.id || typeof latest.source !== 'string') throw Error(t('文档已切换，请重试。'));
        updateSource(active.id, latest.source);
        active.viewState = viewState(latest.viewState);
      } else if (latest !== null) throw Error(t('文档已切换，请重试。'));
      const completed = [], failures = [];
      if (request.action === 'trash') {
        const targets = ids.map(requireTab);
        if (targets.some(tab => !tab.document.path || pathKey(tab.document.path) === pathKey(welcome))) throw Error(getSettings().language === 'en' ? 'Untitled and built-in documents cannot be deleted. Close the tab instead.' : '未命名和内置文档不能删除磁盘文件，请改用关闭标签。');
        const choice = await askUnsaved({ kind: 'trash', name: String(targets.length), files: targets.map(tab => ({ name: displayName(tab), path: tab.document.path, dirty: tab.dirty })), language: getSettings().language });
        if (choice !== 'discard') return { ok: false, canceled: true, completed, failures };
        const seen = new Set();
        for (const tab of targets) {
          const key = pathKey(tab.document.path);
          if (seen.has(key)) continue;
          seen.add(key);
          const index = tabs.indexOf(tab), previousActive = active;
          // Commit exclusion BEFORE trash: a crash cannot restore a deleted path.
          tabs.splice(index, 1);
          if (tab === active) active = tabs[Math.min(index, tabs.length - 1)] || null;
          if (!commit(snapshot())) {
            tabs.splice(index, 0, tab); active = previousActive; persist(snapshot());
            failures.push({ id: tab.id, message: '无法更新恢复记录，文件未删除。' }); break;
          }
          try { await shell.trashItem(tab.document.path); }
          catch (error) {
            tabs.splice(index, 0, tab); active = previousActive;
            const durable = commit(snapshot());
            persist(snapshot());
            failures.push({ id: tab.id, message: `${displayName(tab)}: ${error.message}${durable ? '' : ' — 恢复记录写入失败，请在退出前重试。'}` });
            if (!durable) break;
            continue;
          }
          completed.push(tab.id);
        }
        pushTabs();
        // Present once, only if the visible document was actually removed.
        if (latest && completed.includes(latest.id)) {
          if (active) setActive(active);
          else send('document', { ok: true, empty: true });
        }
        return { ok: !failures.length, completed, failures };
      }
      for (const id of ids) {
        try {
          const result = await closeOne(id);
          if (!result.ok) return { ...result, completed, failures };
          completed.push(id);
        } catch (error) { failures.push({ id, message: error.message }); break; }
      }
      return { ok: !failures.length, completed, failures };
    });
  });

  async function confirmAllLeave() {
    for (const tab of tabs) if (tab.document.path && !(await confirmDirty(tab))) return false;
    return true;
  }

  async function confirmLeaveActive() {
    const result = await exclusive(async () => {
      const latest = await win.webContents.executeJavaScript('window.mdviewPrepareClose()');
      if (!active) return latest === null;
      if (!latest || latest.id !== active.id || typeof latest.source !== 'string') return false;
      updateSource(active.id, latest.source);
      return confirmDirty(active);
    });
    if (result?.message) send('edit-error', result.message);
    return result === true;
  }

  const askRename = require('./rename-dialog.cjs')(win, trusted);
  const { renameTextFile, validateFilename } = require('./document-file.cjs');
  const actions = ['copy-path', 'reveal', 'rename'];
  function requireTab(id) {
    if (!Number.isInteger(id)) throw Error(t('文档不存在。'));
    const tab = findById(id);
    if (!tab) throw Error(t('文档不存在。'));
    return tab;
  }
  function fileError(error) {
    const key = ({ EEXIST: '目标文件已存在，请使用其他名称。', ENOENT: '文件不存在，请重新打开。', EACCES: '没有权限重命名此文件。', EPERM: '没有权限重命名此文件。', ENOTSUP: '此文件系统不支持安全重命名。', EXDEV: '此文件系统不支持安全重命名。' })[error.code];
    return t(key || error.message);
  }
  ipcMain.handle('popup-tab-menu', (event, request) => {
    trusted(event);
    const tab = requireTab(request?.id);
    if (busy) return null;
    const point = request.point;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw Error('Invalid menu point');
    const enabled = Boolean(tab.document.path);
    const labels = ['复制文件全路径', '打开所在文件夹', '重命名'];
    return new Promise(resolve => {
      let chosen = null;
      const menu = Menu.buildFromTemplate(actions.map((action, index) => ({
        id: action, label: t(labels[index]), enabled: enabled && (action !== 'rename' || tab.document.path !== welcome), click: () => { chosen = action; }
      })).concat(enabled ? [] : [{ label: t('请先保存文档。'), enabled: false }]));
      const zoom = win.webContents.getZoomFactor(), [width, height] = win.getContentSize();
      menu.popup({ window: win, x: Math.round(Math.max(0, Math.min(width, point.x * zoom))), y: Math.round(Math.max(0, Math.min(height, point.y * zoom))), callback: () => resolve(chosen) });
    });
  });
  ipcMain.handle('tab-file-action', (event, request) => {
    trusted(event);
    if (!request || !actions.includes(request.action)) throw Error('Invalid tab action');
    const tab = requireTab(request.id);
    return exclusive(async () => {
      // Capture after freezing edits, not when the menu was opened. This also
      // preserves the last keystroke in a DIFFERENT active tab.
      const latest = await win.webContents.executeJavaScript('window.mdviewPrepareClose()');
      if (active) {
        if (!latest || latest.id !== active.id || typeof latest.source !== 'string') throw Error(t('文档已切换，请重试。'));
        updateSource(active.id, latest.source);
        active.viewState = viewState(latest.viewState);
      }
      if (findById(request.id) !== tab) throw Error(t('文档不存在。'));
      if (!tab.document.path) throw Error(t('请先保存文档。'));
      if (request.action === 'copy-path') { await clipboard.writeText(tab.document.path); return { ok: true }; }
      if (request.action === 'reveal') {
        try {
          if (!(await fs.stat(tab.document.path)).isFile()) throw Error('文件不存在，请重新打开。');
          shell.showItemInFolder(tab.document.path);
        } catch (error) { throw Error(fileError(error)); }
        return { ok: true };
      }
      if (tab.document.path === welcome) throw Error(t('请先另存为内置欢迎文档。'));
      let name = tab.document.name, error = '';
      renaming = true;
      try {
        while (true) {
          name = await askRename({ name, error, language: getSettings().language });
          if (name === null) return { ok: false, canceled: true };
          const oldPath = tab.document.path;
          let moved;
          try {
            validateFilename(name);
            const target = path.join(path.dirname(oldPath), name);
            if (tabs.some(other => other !== tab && other.document.path && pathKey(other.document.path) === pathKey(target))) throw Error('目标文件已在其他标签中打开，请使用其他名称。');
            moved = await renameTextFile(tab.document, name);
          } catch (failure) { error = fileError(failure); continue; }
          // Only identity metadata changes: keep the disk baseline, draft, dirty flag,
          // preview, asset approvals, selection/history and view state intact.
          tab.document = { ...tab.document, path: moved.path, name: path.basename(moved.path) };
          if (tab.preview) tab.preview = { ...tab.preview, path: moved.path, name: tab.document.name };
          pushTabs();
          send('renamed', { id: tab.id, oldPath, path: moved.path, name: tab.document.name });
          if (!commit(snapshot())) return { ok: false, message: t('文件已重命名，但恢复记录写入失败。请在退出前重试保存。') };
          return { ok: true };
        }
      } finally { renaming = false; }
    });
  });

  ipcMain.on('workspace-view', (event, payload) => {
    if (win.isDestroyed()) return;
    trusted(event);
    const tab = findById(payload?.id);
    if (!tab) return;
    tab.viewState = viewState(payload);
    persist(snapshot());
  });
  ipcMain.on('draft', (event, payload) => { if (win.isDestroyed()) return; trusted(event); try { updateSource(payload.id, payload.source); } catch (error) { send('edit-error', error.message); } });
  ipcMain.handle('save', (event, payload) => { trusted(event); return exclusive(async () => { updateSource(payload.id, payload.source); return saveTab(active, payload.asNew); }); });
  ipcMain.handle('switch-tab', (event, payload) => { trusted(event); return exclusive(() => switchTab(payload.id, payload.source)); });
  ipcMain.handle('close-tab', (event, payload) => { trusted(event); return closeTab(payload.id, payload.source); });
  const contentSearch = require('./content-search-service.cjs')();
  win.on('closed', () => contentSearch.cancel());
  ipcMain.on('cancel-content-search', event => { trusted(event); contentSearch.cancel(); });
  ipcMain.handle('search-document', async (event, request) => {
    trusted(event);
    if (!request || typeof request.query !== 'string' || request.query.length > 256 ||
        !Number.isInteger(request.id) || !Number.isInteger(request.limit) || request.limit < 0 || request.limit > 500) throw Error('Invalid search');
    // Flush only the live active tab; this endpoint cannot access arbitrary paths.
    if (request.active) {
      if (request.active.id !== active?.id || typeof request.active.source !== 'string') return null;
      if (request.active.source !== active.source) updateSource(active.id, request.active.source);
    }
    const tab = findById(request.id);
    if (!tab) return null;
    const source = tab.source;
    const result = await contentSearch.search({ source, query: request.query, caseSensitive: request.caseSensitive === true, limit: request.limit });
    return findById(request.id) === tab && source === tab.source ? result : null;
  });
  ipcMain.handle('preview', async (event, payload) => {
    trusted(event);
    const tab = findById(payload.id);
    if (!tab || typeof payload.source !== 'string' || Buffer.byteLength(payload.source) > MAX_DOCUMENT) throw Error('无效文档');
    const current = tab.document;
    const rendered = { ...await renderMarkdown(payload.source, current.path ? path.dirname(current.path) : getSettings().saveDirectory), source: payload.source, characters: payload.source.length };
    // Keep the draft reader view with its source, not the original disk HTML.
    if (findById(payload.id) === tab && tab.source === payload.source) tab.preview = rendered;
    return { ...current, ...rendered, id: payload.id };
  });
  win.on('close', event => {
    event.preventDefault();
    if (busy) return;
    exclusive(async () => {
      // A renderer round trip, after freezing edits, captures the final keystroke
      // and view state instead of trusting potentially queued fire-and-forget IPC.
      const latest = await win.webContents.executeJavaScript('window.mdviewPrepareClose()');
      if (active) {
        if (!latest || latest.id !== active.id || typeof latest.source !== 'string') throw Error('无法读取当前草稿，窗口未关闭。');
        updateSource(active.id, latest.source);
        active.viewState = viewState(latest.viewState);
      } else if (latest !== null) throw Error('文档状态已改变，窗口未关闭。');
      if (!(await confirmAllLeave())) return;
      if (!commit(snapshot())) throw Error('无法保存草稿恢复数据（磁盘不可写或超过容量限制）。窗口未关闭，请保存文档后重试。');
      win.destroy(); // Only a durable accepted WINDOW EXIT bypasses beforeunload.
    }).then(result => { if (result?.message) send('edit-error', result.message); });
  });
  win.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', message: t('放弃未保存的修改并重新加载界面？'), buttons: ['取消', '放弃修改'].map(t), defaultId: 0, cancelId: 0 });
    if (response === 1) { if (active) active.dirty = false; event.preventDefault(); }
  });
  return {
    snapshot,
    get renaming() { return renaming; },
    async restore(workspace) {
      // Hydrate without intermediate document events: renderer sees only the final active tab.
      for (const document of workspace.documents) {
        const blank = { path: '', name: '未命名.md', source: '', html: '', editorHtml: '', headings: [], warnings: [], characters: 0, fingerprint: null, bom: false, newline: '\n' };
        const restored = document.path ? document : { ...blank, createdAt: document.createdAt ?? null, updatedAt: document.updatedAt ?? null, viewState: document.viewState };
        const source = document.path ? restored.source : document.source || '';
        if (!document.path) Object.assign(restored, await renderMarkdown(source, getSettings().saveDirectory), { characters: source.length });
        tabs.push({ id: ++sequence, document: restored, source, dirty: source !== restored.source, viewState: viewState(document.viewState) });
      }
      active = tabs[workspace.activeIndex] || tabs[0] || null;
    },
    present() { if (active) setActive(active); },
    get file() { return active?.document.path; },
    refreshTitle,
    openDocument,
    async openDocuments(files) {
      const result = await exclusive(async () => {
        const latest = await win.webContents.executeJavaScript('window.mdviewPrepareClose()');
        if (active) {
          if (!latest || latest.id !== active.id || typeof latest.source !== 'string') throw Error(t('文档已切换，请重试。'));
          updateSource(active.id, latest.source);
          active.viewState = viewState(latest.viewState);
        } else if (latest !== null) throw Error(t('文档已切换，请重试。'));
        const previous = active, opened = [], errors = [];
        // Sequential reads preserve native selection order. Only present the final
        // tab: intermediate document events can race renderer draft/view capture.
        for (const file of files) {
          try {
            const document = await require('./markdown.cjs').readDocument(file);
            acceptDocument(document, false, false);
            opened.push(document.path);
          } catch (error) {
            const message = error.code === 'ENOENT' ? '文件不存在或已被移动。' : ['EACCES', 'EPERM'].includes(error.code) ? '无法读取此文件，请检查权限。' : error.message;
            errors.push(`${file}: ${t(message)}`);
          }
        }
        if (active !== previous) setActive(active);
        if (errors.length) send('edit-error', errors.join('\n'));
        return { ok: errors.length === 0, opened, errors };
      });
      if (result?.message) send('edit-error', t(result.message));
      return result;
    },
    newBlank,
    confirmLeaveActive,
    switchTab,
    closeTab,
    saveTab,
  };
};
