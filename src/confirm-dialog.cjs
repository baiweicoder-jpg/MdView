const { ipcMain } = require('electron');
const { randomUUID } = require('node:crypto');

// Main owns the question and its lifetime. Renderer can only answer the current ID.
module.exports = function createConfirmation(win, trusted) {
  const contents = win.webContents;
  let pending;
  const finish = choice => {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    try { if (!contents.isDestroyed()) contents.send('unsaved-confirm-dismiss', current.id); }
    catch { /* Renderer loss must still release the close/save barrier. */ }
    current.resolve(choice);
  };
  const answer = (event, payload) => {
    try { trusted(event); } catch { return; }
    if (!pending || payload?.id !== pending.id || !['save', 'discard', 'cancel'].includes(payload.choice)) return;
    finish(payload.choice);
  };
  const cancel = () => finish('cancel');
  const navigating = (_event, _url, _inPlace, mainFrame) => { if (mainFrame) cancel(); };
  ipcMain.on('unsaved-confirm-answer', answer);
  contents.on('did-start-navigation', navigating);
  contents.on('render-process-gone', cancel);
  contents.once('destroyed', () => { cancel(); ipcMain.removeListener('unsaved-confirm-answer', answer); });
  return function ask(question) {
    if (pending || contents.isDestroyed()) return Promise.resolve('cancel');
    return new Promise(resolve => {
      const id = randomUUID();
      // A lost renderer/listener must never leave fileBusy held indefinitely.
      const timer = setTimeout(cancel, 120000);
      pending = { id, resolve, timer };
      try { contents.send('unsaved-confirm', { id, ...question }); }
      catch { cancel(); }
    });
  };
};
