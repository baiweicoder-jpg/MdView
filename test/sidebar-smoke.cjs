const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ win, openDocument, app }) => {
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  async function waitFor(code) {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(code)) return;
      await delay(40);
    }
    throw new Error(`Sidebar timed out: ${code}`);
  }
  assert.equal(await evaluate("!!document.querySelector('#sidebar-tabs')"), true, 'shared sidebar must mount');
  const directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'mdview-sidebar-'));
  const first = path.join(directory, 'Sidebar Alpha.md');
  const second = path.join(directory, 'Sidebar Beta.md');
  await fs.writeFile(first, '# Alpha\n\n' + Array.from({ length: 24 }, (_, i) => `## Section ${i}\n\nSidebar paragraph.\n\n`).join(''));
  await fs.writeFile(second, '# Beta\n\nSecond document.');
  await openDocument(first, false);
  await openDocument(second, false);
  await waitFor("currentDocument?.name === 'Sidebar Beta.md'");
  await evaluate("document.querySelector('#sidebar-tab-files').click()");
  await waitFor("document.querySelectorAll('.sidebar-file').length === tabs.length");
  assert.equal(await evaluate("document.querySelector('#outline-panel').hidden"), true);
  await evaluate("document.querySelector('#opened-files-search').value = 'ALPHA'; document.querySelector('#opened-files-search').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('.sidebar-file').length"), 1);
  const count = await evaluate('tabs.length');
  await evaluate("document.querySelector('.sidebar-file').click()");
  await waitFor("currentDocument?.name === 'Sidebar Alpha.md'");
  assert.equal(await evaluate('tabs.length'), count, 'file list switches existing tabs');
  await evaluate("document.querySelector('#opened-files-search').value = ''; document.querySelector('#opened-files-search').dispatchEvent(new Event('input'))");
  await waitFor("document.querySelector('.sidebar-file[aria-current=\"page\"] .tab-name')?.textContent === 'Sidebar Alpha.md'");
  await evaluate("toggleEditing(); richEditor.editor.commands.insertContent('Sidebar unsaved draft')");
  await waitFor("!!document.querySelector('.sidebar-file.active.dirty .sidebar-file-dirty')?.textContent");
  const draft = await evaluate('richEditor.source()');
  await evaluate("document.querySelector('.sidebar-file.active').click()");
  assert.equal(await evaluate('richEditor.source()'), draft, 'active file click preserves current editor draft');
  await evaluate('richEditor.editor.commands.undo()');
  await waitFor("!tabs.find(tab => tab.active)?.dirty");
  await evaluate("document.querySelector('#opened-files-search').value = 'no-such-sidebar-file'; document.querySelector('#opened-files-search').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelector('#opened-files-empty').hidden"), false);
  await evaluate("document.querySelector('#sidebar-tab-files').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))");
  assert.equal(await evaluate("document.activeElement.id"), 'sidebar-tab-outline');
  await evaluate('toggleEditing()');
  await evaluate("document.querySelector('#sidebar-tab-outline').click()");
  assert.equal(await evaluate("document.querySelectorAll('#outline a').length"), 25);
  await evaluate("document.querySelectorAll('#outline a')[20].click()");
  await waitFor("document.querySelector('#reader').scrollTop > 200");
  assert.equal(await evaluate("!!document.querySelector('#sidebar-resizer')"), true, 'sidebar has accessible resize handle');
  const width = () => evaluate("document.querySelector('#sidebar').getBoundingClientRect().width");
  const before = await width();
  await evaluate("document.querySelector('#sidebar-resizer').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))");
  assert.equal(await width(), before + 10);
  assert.equal(await evaluate("Number(localStorage.getItem('mdview-sidebar-width'))"), before + 10);
  win.webContents.debugger.attach('1.3');
  try {
    const point = await evaluate("(() => { const r = document.querySelector('#sidebar-resizer').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 40 }; })()");
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x + 45, y: point.y, button: 'left', buttons: 1 });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x + 45, y: point.y, button: 'left', clickCount: 1 });
  } finally { win.webContents.debugger.detach(); }
  assert.equal(await width(), before + 55);
  const saved = await width();
  // Earlier desktop suites can leave other tabs dirty; this reload tests only
  // sidebar preferences. Main still owns those drafts across renderer reloads.
  const { dialog } = require('electron');
  const originalConfirm = dialog.showMessageBoxSync;
  dialog.showMessageBoxSync = () => 1;
  try {
    const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.webContents.reload();
    await Promise.race([loaded, delay(8000).then(() => { throw new Error('Sidebar reload timed out'); })]);
  } finally { dialog.showMessageBoxSync = originalConfirm; }
  await waitFor("!!document.querySelector('#sidebar-resizer')");
  assert.equal(await width(), saved, 'width survives renderer reload');
  win.setSize(800, 650);
  await delay(150);
  await evaluate("document.querySelector('#sidebar-resizer').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))");
  assert.equal(await evaluate("document.querySelector('#sidebar').getBoundingClientRect().width <= innerWidth * .45 && document.documentElement.scrollWidth <= innerWidth"), true);
  await evaluate("document.querySelector('#toggle-outline').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#sidebar')).display"), 'none');
  await evaluate("document.querySelector('#toggle-outline').click()");
  console.log('Sidebar smoke: files search/switch, active state, outline navigation, keyboard/real pointer resize, persisted reload, responsive clamp and toggle passed');
};
