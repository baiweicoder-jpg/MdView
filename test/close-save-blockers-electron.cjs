const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');
const dir = process.env.MDVIEW_SESSION_TEST_DIR;
const phase = process.env.MDVIEW_SESSION_PHASE;
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0); win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
  win.webContents.setBackgroundThrottling(false); win.showInactive();
});
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
(async () => {
  const { win, editSession } = await require('../src/main.cjs');
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async check => {
    for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
    assert.fail('renderer did not settle');
  };
  const originals = { showMessageBox: dialog.showMessageBox, showMessageBoxSync: dialog.showMessageBoxSync, showSaveDialog: dialog.showSaveDialog };
  try {
    await wait(() => run('!!currentDocument && !restoringView'));
    if (phase === 'empty') {
      await run('toggleEditing()');
      await run('richEditor.editor.commands.insertContent("discard final draft"); changed()');
      // Ordinary load errors must still retain the live editor and its source.
      const before = await run('payload()');
      await run('processDocument({ok:false,message:"ordinary load failure"})');
      assert.deepEqual(await run('payload()'), before);
      dialog.showMessageBox = async () => ({ response: 1 });
      await run('closeTab(currentDocument.id)');
      await wait(() => run('tabs.length === 0 && !fileBusy'));
      assert.deepEqual(editSession.snapshot().tabs, []);
      assert.equal(await run('currentDocument == null && richEditor == null && displayedDocument == null && !editing && !restoringView'), true, 'last-tab close must clear renderer document/editor');
      assert.equal(await run('document.querySelector("#editor-content").textContent + document.querySelector("#content").textContent'), '');
      assert.equal(await run('window.mdviewPrepareClose()'), null);
    }
    if (phase === 'collision') {
      const target = path.join(dir, 'A.md');
      fs.writeFileSync(target, '# original disk\n');
      const { readDocument } = require('../src/markdown.cjs');
      editSession.openDocument(await readDocument(target));
      await wait(() => run('currentDocument?.name === "A.md" && !restoringView'));
      await run('toggleEditing(); richEditor.editor.commands.insertContent("named dirty edit"); changed()');
      const named = await run('payload()');
      await run('window.mdview.newDocument()');
      await wait(() => run('currentDocument?.path === "" && !restoringView'));
      await run('richEditor.editor.commands.insertContent("independent source draft"); changed()');
      const draft = await run('payload()');
      const destinations = process.platform === 'win32' ? [target, path.join(dir, 'a.MD')] : [target];
      for (const destination of destinations) {
        dialog.showSaveDialog = async () => ({canceled:false, filePath:destination});
        const result = await run('window.mdview.save({...payload(),asNew:true})');
        assert.equal(result.ok, false, 'Save As to another open tab must reject');
        assert.equal(fs.readFileSync(target, 'utf8'), '# original disk\n', 'collision must reject BEFORE writing destination');
        assert.deepEqual(await run('payload()'), draft, 'source draft remains untitled and unchanged');
        assert.equal(editSession.snapshot().tabs.at(-1).path, '');
      }
      await run(`switchToTab(${named.id})`);
      await wait(() => run('!restoringView'));
      assert.deepEqual(await run('payload()'), named, 'existing dirty tab contents survive');
      await run(`switchToTab(${draft.id})`);
      await wait(() => run('!restoringView'));
      const { validateSession } = require('../src/workspace-session.cjs');
      assert.deepEqual(validateSession(editSession.snapshot()), editSession.snapshot(), 'tabs remain valid without deduplication');
      // Save the named edit through the ordinary exit prompt; recover the untitled draft.
      dialog.showMessageBox = async () => ({response:0});
    }
    if (phase !== 'collision') dialog.showMessageBox = async () => assert.fail('unexpected exit prompt');
    dialog.showMessageBoxSync = () => assert.fail('unexpected unload prompt');
    const closed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('normal window exit blocked')), 5000);
      win.once('closed', () => { clearTimeout(timer); resolve(); });
    });
    win.close();
    await closed;
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'profile', 'session.json'), 'utf8'));
    if (phase === 'empty') assert.deepEqual(disk, { version: 2, tabs: [], activeIndex: 0 });
    if (phase === 'collision') {
      assert.equal(disk.tabs.length, 3);
      assert.equal(disk.tabs.at(-1).path, '');
      assert.equal(disk.tabs.at(-1).source, 'independent source draft');
      assert.match(fs.readFileSync(path.join(dir, 'A.md'), 'utf8'), /named dirty edit/);
    }
    console.log(`BLOCKER ${phase} PASS`);
  } finally { Object.assign(dialog, originals); }
})().catch(error => { console.error(error); app.exit(1); });
