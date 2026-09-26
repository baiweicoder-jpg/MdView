const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Menu } = require('electron');
module.exports = async function menuBarSmoke({ win, app }) {
  const js = code => win.webContents.executeJavaScript(code, true);
  const wait = async condition => {
    for (let i = 0; i < 100; i++) { if (await js(condition)) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw Error(`Timed out: ${condition}`);
  };
  await wait('document.querySelector("#menu-bar")?.dataset.ready === "true"');
  const original = await js('window.mdview.getSettings()');
  const originalState = (await js('window.mdview.getMenuBar()')).state;
  try {
    assert.equal(win.isMenuBarVisible(), false);
    assert.equal(Menu.getApplicationMenu().items.length, 4);
    assert.ok(Menu.getApplicationMenu().items[0].submenu.items.some(item => item.accelerator === 'Ctrl+S'));
    await js('window.mdview.setQuickActions(["edit", "save", "open", "new"])');
    await wait('document.querySelectorAll("#quick-actions button").length === 4');
    const geometry = await js(`(() => { const row = document.querySelector('#menu-bar').getBoundingClientRect(); const menus = document.querySelector('.menu-bar-menus').getBoundingClientRect(); const actions = document.querySelector('#quick-actions').getBoundingClientRect(); return { top: row.top, height: row.height, tabTop: document.querySelector('#tab-bar').getBoundingClientRect().top, sameRow: menus.top === actions.top, right: actions.left > menus.right, icons: document.querySelectorAll('#quick-actions svg').length }; })()`);
    assert.deepEqual(geometry, { top: 0, height: 30, tabTop: 30, sameRow: true, right: true, icons: 4 });
    await js('window.mdview.quickAction("settings")');
    await wait('document.querySelector("#settings-dialog").open');
    await js('document.querySelector("#quick-action-settings input[value=outline]").click()');
    await wait('!!document.querySelector("[data-quick-action=outline]")');
    const persisted = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    assert.deepEqual(persisted.quickActions, ['edit', 'save', 'open', 'new', 'outline']);
    // Load settings afresh from the real disk file without replacing the live IPC handlers.
    const freshModule = { exports: {} };
    const settingsSource = await fs.readFile(path.join(__dirname, '../src/settings.cjs'), 'utf8');
    const settingsRequire = id => id === 'electron' ? { app, dialog: {}, ipcMain: { handle() {} } } : id === './i18n.cjs' ? require('../src/i18n.cjs') : require(id);
    new Function('require', 'module', settingsSource)(settingsRequire, freshModule);
    const freshSettings = await freshModule.exports(win, () => {});
    assert.deepEqual(freshSettings().quickActions, persisted.quickActions);
    await js('document.querySelector("#settings-dialog").close(); window.mdview.setLanguage("en")');
    await wait('document.querySelector(".menu-bar-menus button").textContent === "File"');
    assert.equal(await js('document.querySelector("#quick-action-settings legend").textContent'), 'Menu bar quick actions');
    assert.equal(win.isMenuBarVisible(), false);
    const wasEditing = await js('!document.querySelector("#editor-content").hidden');
    await js('document.querySelector("[data-quick-action=edit]").click()');
    await wait(`document.querySelector('#editor-content').hidden === ${wasEditing}`);
    await js('document.querySelector("[data-quick-action=edit]").click()');
    await wait(`document.querySelector('#editor-content').hidden === ${!wasEditing}`);
    await js('window.mdview.menuState({ editing: true })');
    await wait('document.querySelector("[data-quick-action=edit]").getAttribute("aria-pressed") === "true"');
    win.webContents.send('file-busy', true);
    await wait('document.querySelector("[data-quick-action=save]").disabled');
    win.webContents.send('file-busy', false);
    await wait('!document.querySelector("[data-quick-action=save]").disabled');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'F10' });
    await wait('document.activeElement.matches(".menu-bar-menus button")');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
    await wait('document.activeElement.dataset.menuIndex === "1"');
    const native = Menu.getApplicationMenu().items[0].submenu;
    const popup = native.popup;
    let position;
    native.popup = function(options) { position = options; return popup.call(this, options); };
    try {
      win.webContents.setZoomFactor(1.25);
      const pending = js('window.mdview.popupMenu(0, { x: 8, y: 28 })');
      for (let i = 0; i < 100 && !position; i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(position.x, 10);
      assert.equal(position.y, 35);
      native.closePopup(win);
      await pending;
    } finally { native.popup = popup; win.webContents.setZoomFactor(1); }
    const invalid = await js(`Promise.all([window.mdview.quickAction('constructor'), window.mdview.setQuickActions(['save', 'save']), window.mdview.popupMenu(-1, {x:0,y:0})].map(p => p.then(() => false, () => true)))`);
    assert.deepEqual(invalid, [true, true, true]);
    await js('window.mdview.setQuickActions([])');
    await wait('document.querySelectorAll("#quick-actions button").length === 0');
  } finally {
    await js(`window.mdview.setQuickActions(${JSON.stringify(original.quickActions)})`);
    await js(`window.mdview.setLanguage(${JSON.stringify(original.language)})`);
    await js(`window.mdview.menuState(${JSON.stringify(originalState)})`);
  }
  console.log('Menu bar smoke passed: native popups, one-row geometry, persisted settings, bilingual chrome, keyboard focus, action allowlist');
};
