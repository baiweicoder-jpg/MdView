const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ win, app, openDocument }) => {
  const evaluate = code => win.webContents.executeJavaScript(code, true);
  const waitFor = async code => {
    for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(30); }
    throw Error(`Timed out: ${code}`);
  };
  await waitFor("!!document.querySelector('#ui-language')");
  const fixture = path.join(app.getPath('userData'), 'i18n-fixture.md');
  await fs.writeFile(fixture, '# Language test\n\n```js\nconst answer = 42;\n```\n');
  await openDocument(fixture);
  await waitFor("document.querySelector('#file-name').textContent === 'i18n-fixture.md'");
  const original = await evaluate('window.mdview.getSettings()');
  const originalDocument = await evaluate("({text: document.querySelector('#content').textContent, code: [...document.querySelectorAll('#content pre code')].map(node => node.textContent), name: document.querySelector('#file-name').textContent})");
  try {
    require('electron').Menu.getApplicationMenu().getMenuItemById('language-en').click();
    await waitFor("document.documentElement.lang === 'en'");
    assert.equal(await evaluate("document.querySelector('#settings-title').textContent"), 'Settings');
    assert.equal(require('electron').Menu.getApplicationMenu().items[0].label, 'File');
    assert.equal(await evaluate("document.querySelector('#ui-language').value"), 'en');
    const stored = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
    assert.equal(stored.language, 'en');
    assert.equal((await evaluate('window.mdview.getSettings()')).saveDirectory, original.saveDirectory);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#content pre code')].map(node => node.textContent)"), originalDocument.code);
    assert.equal(await evaluate("document.querySelector('#file-name').textContent"), originalDocument.name);
    if (await evaluate("!!document.querySelector('#content .expand-code')")) {
      assert.equal(await evaluate("document.querySelector('#content .copy-code').textContent"), 'Copy');
      await evaluate("document.querySelector('#content .expand-code').click()");
      assert.match(await evaluate("document.querySelector('#code-dialog-title').textContent"), /^View code ·/);
      await evaluate("document.querySelector('#code-dialog .copy-code').click()");
      await waitFor("document.querySelector('#code-dialog-status').textContent === 'Code copied'");
      await evaluate("document.querySelector('#close-code-dialog').click()");
    }
    // Recreate the renderer; it must recover the persisted language via the main process.
    const { dialog } = require('electron');
    const originalConfirm = dialog.showMessageBoxSync;
    dialog.showMessageBoxSync = () => 1;
    try {
      const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
      win.webContents.reload();
      await loaded;
      await waitFor("document.documentElement.lang === 'en' && !!document.querySelector('#ui-language')");
    } finally { dialog.showMessageBoxSync = originalConfirm; }
    assert.equal(await evaluate("document.querySelector('#settings-title').textContent"), 'Settings');
    await assert.rejects(evaluate("window.mdview.setLanguage('fr')"));
    await evaluate('window.mdview.newDocument()');
    await waitFor("document.querySelector('#edit-status').textContent === 'Editing'");
    assert.equal(await evaluate("document.querySelector('#file-name').textContent"), 'Untitled.md');
    assert.match(win.getTitle(), /Untitled\.md/);
    const originalSave = dialog.showSaveDialog;
    let saveOptions;
    dialog.showSaveDialog = async (_win, options) => { saveOptions = options; return { canceled: true }; };
    try { await evaluate('saveDocument()'); }
    finally { dialog.showSaveDialog = originalSave; }
    assert.equal(saveOptions.title, 'Save Markdown');
    assert.equal(path.basename(saveOptions.defaultPath), 'Untitled.md');
    await evaluate("richEditor.editor.commands.insertContent('Draft')");
    const originalQuestion = dialog.showMessageBox;
    let question;
    dialog.showMessageBox = async (_win, options) => { question = options; return { response: 2 }; };
    try { await evaluate('closeTab(currentDocument.id)'); }
    finally { dialog.showMessageBox = originalQuestion; }
    assert.match(question.message, /has unsaved changes/);
    assert.deepEqual(question.buttons, ['Save', 'Don’t save', 'Cancel']);
    await evaluate('richEditor.editor.commands.undo()');
    assert.match(await evaluate("document.querySelector('#document-status').textContent"), /characters/);
    await evaluate("document.querySelector('#ui-language').value = 'zh-CN'; document.querySelector('#ui-language').dispatchEvent(new Event('change'))");
    await waitFor("document.querySelector('#edit-status').textContent === '编辑中'");
    assert.equal(require('electron').Menu.getApplicationMenu().items[0].label, '文件');
    assert.equal(await evaluate("document.querySelector('#settings-title').textContent"), '设置');
    console.log('i18n smoke passed: native menus, settings persistence, invalid locale, dynamic editor states, reversible UI translation');
  } finally { await evaluate(`window.mdview.setLanguage(${JSON.stringify(original.language || 'zh-CN')})`); }
};

if (require.main === module) {
  // Fast resource contract check; the exported function runs in the desktop smoke suite.
  const i18n = require('../src/i18n.cjs');
  assert.equal(i18n.translate('文件', 'en'), 'File');
  assert.equal(i18n.translate('文件', 'zh-CN'), '文件');
  console.log('i18n resource contract passed');
}
