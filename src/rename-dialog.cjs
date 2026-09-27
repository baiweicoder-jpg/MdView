const { ipcMain } = require('electron');
const { randomUUID } = require('node:crypto');
module.exports = function renameDialog(win, trusted) {
  const contents = win.webContents;
  let pending;
  function finish(value) {
    if (!pending) return;
    const current = pending; pending = null; clearTimeout(current.timer);
    try { if (!contents.isDestroyed()) contents.send('rename-dismiss', current.id); } catch {}
    current.resolve(value);
  }
  const answer = (event, value) => {
    try { trusted(event); } catch { return; }
    if (!pending || value?.id !== pending.id || !(value.name === null || (typeof value.name === 'string' && value.name.length <= 255))) return;
    finish(value.name);
  };
  ipcMain.on('rename-answer', answer);
  contents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) finish(null); });
  contents.on('render-process-gone', () => finish(null));
  contents.once('destroyed', () => { finish(null); ipcMain.removeListener('rename-answer', answer); });
  return question => new Promise(resolve => {
    if (pending || contents.isDestroyed()) return resolve(null);
    const id = randomUUID();
    pending = { id, resolve, timer: setTimeout(() => finish(null), 120000) };
    try { contents.send('rename-question', { ...question, id }); } catch { finish(null); }
  });
};
