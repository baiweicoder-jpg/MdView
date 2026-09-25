const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');
module.exports = async ({ win, openDocument, app }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  await run("if (codeDialog.open) codeDialog.close()");
  assert.equal(await run("!!$('#new svg') && !!$('#save svg') && !!$('#toggle-editor-tools svg')"), true, 'local icons render on primary controls');
  await run("$('#more-actions').click()");
  assert.equal(await run("$('#file-actions').matches(':popover-open')"), true);
  assert.equal(await run("$('#save-as').checkVisibility() && $('#reload').checkVisibility()"), true);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await run("$('#file-actions').matches(':popover-open')"), false);
  await run("$('#view-options').click()");
  assert.equal(await run("$('#view-panel').matches(':popover-open') && $('#theme').checkVisibility()"), true);
  await run("$('#view-options').click()");
  assert.equal(await run("$('.toolbar').getBoundingClientRect().height <= 64"), true, 'toolbar stays on one line in narrow window');
  const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'mdview-edit-'));
  const file = path.join(dir, 'edit.md');
  const source = '# Title\n\nA **bold** paragraph.\n\n```js\nconst n = 1;\n```\n\n![missing](missing.png)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
  await fs.writeFile(file, source);
  await openDocument(file);
  await run('toggleEditing()');
  assert.equal(await run("$('#editor-tools').parentElement.classList.contains('workspace')"), true, 'format tools live beside the document, not above it');
  assert.equal(await run("$('#editor-tools').getBoundingClientRect().left >= $('#reader').getBoundingClientRect().right"), true);
  assert.equal(await run("$('#toggle-editor-tools').getAttribute('aria-expanded')"), 'true');
  const expandedWidth = await run("$('#reader').clientWidth");
  await run("$('#toggle-editor-tools').click()");
  assert.equal(await run("$('#toggle-editor-tools').getAttribute('aria-expanded')"), 'false');
  assert.equal(await run("$('#editor-panel-body').hidden"), true);
  assert.ok(await run("$('#reader').clientWidth") > expandedWidth);
  assert.equal(await run('payload().source'), source, 'collapsing tools preserves content');
  await run('toggleEditing()');
  assert.equal(await run("$('#editor-tools').hidden"), true);
  await run('toggleEditing()');
  assert.equal(await run("$('#toggle-editor-tools').getAttribute('aria-expanded')"), 'false', 'collapse preference survives mode changes');
  assert.equal(await run("JSON.parse(localStorage.getItem('mdview-preferences')).toolsCollapsed"), true);
  await run("$('#toggle-editor-tools').click()");
  assert.equal(await run('editing && !!richEditor.editor.view.dom.querySelector(".code-block .expand-code")'), true);
  assert.equal(await run("$('#block-type').value"), '1', 'inspector reflects selected heading');
  assert.equal(await run("$('[data-edit=deleteTable]').disabled"), true, 'table actions disabled outside tables');
  await run("richEditor.editor.commands.setTextSelection({ from: 1, to: 6 }); $('[data-edit=toggleBold]').click()");
  assert.equal(await run("$('[data-edit=toggleBold]').getAttribute('aria-pressed')"), 'true');
  await run("$('[data-edit=undo]').click()");
  assert.equal(await run('payload().source'), source, 'entering editor preserves exact original source');
  await run("richEditor.editor.commands.insertContentAt(1, 'Edited ')");
  assert.match(await run('payload().source'), /Edited Title/);
  assert.match(await run('payload().source'), /missing\.png/);
  assert.equal(await run("!!$('#editor-content .hljs-keyword')"), true);
  await run("$('#editor-content .expand-code').click()");
  assert.equal(await run('codeDialog.open'), true);
  await run("document.dispatchEvent(new WheelEvent('wheel', { ctrlKey:true, deltaY:-100, cancelable:true })); codeDialog.close()");
  await run('saveDocument()');
  assert.match(await fs.readFile(file, 'utf8'), /Edited Title/);
  await run('toggleEditing()');
  assert.match(await run("$('#content').textContent"), /Edited Title/);
  await run('toggleEditing(); richEditor.editor.commands.insertContentAt(1, "Unsaved ")');
  const originalDialog = dialog.showMessageBox;
  dialog.showMessageBox = async () => ({ response: 2 });
  try { await openDocument(file); assert.match(await run('payload().source'), /Unsaved/); }
  finally { dialog.showMessageBox = originalDialog; }
  await fs.writeFile(file, 'External change');
  await run('saveDocument()');
  assert.equal(await fs.readFile(file, 'utf8'), 'External change');
  assert.match(await run("$('#notice').textContent"), /其他程序/);
  const saveDialog = dialog.showSaveDialog;
  const copied = path.join(dir, 'saved-as.md');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: copied });
  try { await run('saveDocument(true)'); }
  finally { dialog.showSaveDialog = saveDialog; }
  assert.match(await fs.readFile(copied, 'utf8'), /Unsaved/);
  assert.equal(await run("$('#edit-status').textContent"), '编辑中');
  await run('window.mdview.reload()');
  assert.equal(await run('currentDocument.path'), copied);
  await run('toggleEditing()');
  await run("richEditor.editor.commands.insertContentAt(1, '中文输入 ')");
  assert.match(await run('payload().source'), /中文输入/);
  await run('richEditor.editor.commands.undo()');
  assert.doesNotMatch(await run('payload().source'), /中文输入/);
  assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true);
  const screenshot = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { win.webContents.off('paint', paint); reject(Error('Editor screenshot timed out')); }, 8000);
    function paint(_event, _dirty, image) {
      if (image.isEmpty()) { win.webContents.invalidate(); return; }
      clearTimeout(timer); win.webContents.off('paint', paint); resolve(image);
    }
    win.webContents.on('paint', paint); win.webContents.invalidate();
  });
  await fs.writeFile(path.join(process.cwd(), 'artifacts', app.isPackaged ? 'packaged' : 'desktop', 'editor.png'), screenshot.toPNG());
  await run('window.mdview.newDocument()');
  assert.equal(await run('editing && richEditor.editor.isEditable'), true);
  assert.equal(await run('payload().source'), '');
  assert.equal(await run('richEditor.editor.getText()'), '');
  assert.equal(await run('currentDocument.path'), '');
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await run('richEditor.editor.view.dom.contains(document.activeElement)'), true);
  await run("richEditor.editor.commands.insertContent('新文档内容')");
  const unnamedId = await run('currentDocument.id');
  await run('window.mdview.newDocument()');
  assert.equal(await run('payload().source'), '', 'new tab is blank');
  await run(`switchToTab(${unnamedId})`);
  assert.match(await run('payload().source'), /新文档内容/, 'draft survives adding another tab');
  dialog.showSaveDialog = async () => ({ canceled: true });
  try {
    await run('saveDocument()');
    assert.equal(await run('currentDocument.path'), '');
    assert.match(await run('payload().source'), /新文档内容/);
  } finally { dialog.showSaveDialog = saveDialog; }
  const created = path.join(dir, 'new.md');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: created });
  try { await run('saveDocument()'); }
  finally { dialog.showSaveDialog = saveDialog; }
  assert.match(await fs.readFile(created, 'utf8'), /新文档内容/);
  assert.equal(await run('currentDocument.path'), created);
  const openDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  try { await run('window.mdview.chooseSaveDirectory()'); }
  finally { dialog.showOpenDialog = openDialog; }
  assert.equal((await run('window.mdview.getSettings()')).saveDirectory, dir);
  const persisted = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  assert.equal(persisted.saveDirectory, dir);
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  try { await run('window.mdview.chooseSaveDirectory()'); }
  finally { dialog.showOpenDialog = openDialog; }
  assert.equal((await run('window.mdview.getSettings()')).saveDirectory, dir);
  await run('window.mdview.newDocument()');
  let defaultPath;
  dialog.showSaveDialog = async (_win, options) => { defaultPath = options.defaultPath; return { canceled: true }; };
  try { await run('saveDocument()'); }
  finally { dialog.showSaveDialog = saveDialog; }
  assert.equal(defaultPath, path.join(dir, '未命名.md'));
  await run("$('#settings').click()");
  await run('new Promise(resolve => setTimeout(resolve, 50))');
  assert.equal(await run("$('#settings-dialog').open"), true);
  assert.equal(await run("$('#save-directory').textContent"), dir);
  await run("$('#close-settings').click()");
  await run('window.mdview.resetSaveDirectory()');
  assert.equal((await run('window.mdview.getSettings()')).saveDirectory, app.getPath('documents'));
  console.log('Editor smoke: editing, protected saves, editable new documents and persistent save directory passed');
};
