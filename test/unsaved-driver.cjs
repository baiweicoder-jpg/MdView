// Compatibility adapter for older suites that stubbed native message boxes.
// Test-only: answers the *real renderer modal* and its actual preload IPC bridge.
const { dialog } = require('electron');
const installed = new WeakSet();
module.exports = function installUnsavedDriver(win) {
  if (installed.has(win)) return;
  installed.add(win);
  const contents = win.webContents;
  const send = contents.send.bind(contents);
  contents.send = (channel, ...args) => {
    const result = send(channel, ...args);
    if (channel === 'unsaved-confirm') {
      const question = args[0];
      (async () => {
        for (let attempt = 0; attempt < 200; attempt++) {
          if (contents.isDestroyed()) return;
          if (await contents.executeJavaScript("!!document.querySelector('#unsaved-dialog[open]')")) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        const options = await contents.executeJavaScript(`(() => {
          const modal = document.querySelector('#unsaved-dialog[open]');
          if (!modal) throw Error('Custom unsaved dialog was not wired');
          return { message: ${JSON.stringify(question.language === 'en' ? `${question.name} has unsaved changes` : `「${question.name}」有未保存的修改`)},
            buttons: ['save','discard','cancel'].map(choice=>modal.querySelector('.unsaved-actions [data-choice="'+choice+'"]').textContent), defaultId:2,cancelId:2 };
        })()`);
        const { response } = await dialog.showMessageBox(win, options);
        const choice = ['save', 'discard', 'cancel'][response] || 'cancel';
        await contents.executeJavaScript(`document.querySelector('#unsaved-dialog .unsaved-actions [data-choice="${choice}"]').click()`, true);
      })().catch(error => { console.error(error); require('electron').app.exit(1); });
    }
    return result;
  };
};
