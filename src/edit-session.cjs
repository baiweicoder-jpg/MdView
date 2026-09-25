const path = require('node:path');
const { dialog, ipcMain, app } = require('electron');
const { saveTextFile, readTextFile, MAX_DOCUMENT } = require('./document-file.cjs');
const { renderMarkdown } = require('./markdown.cjs');

module.exports = function editingSession(win, trusted, welcome) {
  let document, source, dirty = false, busy = false, id = 0;
  const send = (channel, data) => { if (!win.isDestroyed()) win.webContents.send(channel, data); };
  function draft(payload) {
    if (payload.id !== id || typeof payload.source !== 'string' || Buffer.byteLength(payload.source) > MAX_DOCUMENT) throw Error('文档已切换或内容超过 10 MB。');
    source = payload.source;
    dirty = source !== document.source;
    win.setTitle(`${dirty ? '● ' : ''}${document.name} — MdView`);
  }
  async function save(asNew) {
    const snapshot = source;
    let target = document.path, expectedHash = document.fingerprint;
    if (asNew || target === welcome) {
      const result = await dialog.showSaveDialog(win, { title: '保存 Markdown', defaultPath: target === welcome ? path.join(app.getPath('documents'), '我的文档.md') : target, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled) return { ok: false, canceled: true };
      target = result.filePath;
      if (target === welcome) throw Error('请另选位置保存，保留内置欢迎文档。');
      if (target !== document.path) {
        try { expectedHash = (await readTextFile(target)).fingerprint; }
        catch (error) { if (error.code !== 'ENOENT') throw error; expectedHash = null; }
      }
    } else if (!dirty) return { ok: true };
    const saved = await saveTextFile(target, snapshot, { expectedHash, bom: document.bom, newline: document.newline });
    document = { ...document, ...saved, name: path.basename(target) };
    dirty = source !== snapshot;
    if (!dirty) source = saved.source;
    win.setTitle(`${dirty ? '● ' : ''}${document.name} — MdView`);
    send('saved', { ...saved, id, name: document.name, snapshot, dirty });
    return { ok: true };
  }
  async function exclusive(action) {
    if (busy) return { ok: false, message: '文件正在处理中，请稍候。' };
    busy = true; send('file-busy', true);
    try { return await action(); }
    catch (error) { return { ok: false, message: error.message }; }
    finally { busy = false; send('file-busy', false); }
  }
  async function confirmLeave() {
    if (!dirty) return true;
    const { response } = await dialog.showMessageBox(win, { type: 'question', message: '当前文档有未保存的修改', buttons: ['保存', '不保存', '取消'], defaultId: 2, cancelId: 2 });
    if (response === 2) return false;
    if (response === 1) return true;
    try { return (await save(false)).ok && !dirty; }
    catch (error) { await dialog.showMessageBox(win, { type: 'error', message: error.message }); return false; }
  }
  ipcMain.on('draft', (event, payload) => { trusted(event); try { draft(payload); } catch (error) { send('edit-error', error.message); } });
  ipcMain.handle('save', (event, payload) => { trusted(event); return exclusive(async () => { draft(payload); return save(payload.asNew); }); });
  ipcMain.handle('preview', async (event, payload) => {
    trusted(event);
    if (payload.id !== id || typeof payload.source !== 'string' || Buffer.byteLength(payload.source) > MAX_DOCUMENT) throw Error('无效文档');
    const current = document;
    return { ...current, ...await renderMarkdown(payload.source, path.dirname(current.path)), source: payload.source, characters: payload.source.length, id: payload.id };
  });
  win.on('close', event => {
    if (busy || dirty) {
      event.preventDefault();
      if (!busy) exclusive(async () => { if (await confirmLeave()) { dirty = false; win.destroy(); } });
    }
  });
  win.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(win, { type: 'question', message: '放弃未保存的修改并重新加载界面？', buttons: ['取消', '放弃修改'], defaultId: 0, cancelId: 0 });
    if (response === 1) { dirty = false; event.preventDefault(); }
  });
  return {
    get file() { return document?.path; },
    load: action => exclusive(async () => { if (await confirmLeave()) return action(); }),
    accept(doc) { document = doc; source = doc.source; dirty = false; return { ...doc, id: ++id }; }
  };
};
