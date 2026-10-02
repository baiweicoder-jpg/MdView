const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, dialog } = require('electron');
const root = process.env.MDVIEW_TIMES_DIR || fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-times-ui-'));
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
dialog.showMessageBoxSync = () => 1;
app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0); win.setFocusable(false); win.setSkipTaskbar(true);
  win.webContents.setBackgroundThrottling(false); win.showInactive();
});
(async () => {
  const { win, editSession, openDocument } = await require('../src/main.cjs');
  // Apply to the loaded renderer, not only the not-yet-loaded native window.
  win.webContents.setBackgroundThrottling(false);
  require('./unsaved-driver.cjs')(win);
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 160; i++) { if (await run(code)) return; await new Promise(r => setTimeout(r, 25)); } assert.fail(code); };
  await wait('!!currentDocument && !restoringView');
  if (process.env.MDVIEW_TIMES_PHASE === 'read') {
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
    const times = await run('({createdAt:currentDocument.createdAt, updatedAt:currentDocument.updatedAt, source:payload().source})');
    assert.deepEqual(times, expected, 'separate-process draft recovery preserves exact times and source');
    assert.equal(editSession.snapshot().tabs.at(-1).updatedAt, expected.updatedAt);
    console.log('TIMES separate-process recovery PASS', times);
    app.once('window-all-closed', () => console.log('TIMES read PASS')); win.close(); return;
  }
  editSession.newBlank(); await wait('currentDocument?.path === "" && editing && !restoringView');
  const initial = await run('({createdAt:currentDocument.createdAt,updatedAt:currentDocument.updatedAt})');
  assert.ok(initial.createdAt > 0, 'new draft has actual creation timestamp');
  assert.equal(initial.updatedAt, initial.createdAt);
  await new Promise(r => setTimeout(r, 40));
  await run('changed(); richEditor.editor.commands.focus(); applyTheme(); applyFont();');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(editSession.snapshot().tabs.at(-1).updatedAt, initial.updatedAt, 'no-change callbacks do not update timestamp');
  await run("richEditor.editor.commands.insertContent('Timestamp draft 中文'); changed()");
  await wait(`currentDocument.updatedAt > ${initial.updatedAt}`);
  const edited = await run('currentDocument.updatedAt');
  assert.equal(editSession.snapshot().tabs.at(-1).updatedAt, edited);
  dialog.showSaveDialog = async () => ({ canceled: true });
  await run('saveDocument()');
  assert.equal(await run('currentDocument.updatedAt'), edited);
  const source = await run('payload().source');
  for (const mode of [true, false]) {
  await run(`if (editing !== ${mode}) toggleEditing()`);
  for (const width of [1280, 700, 460]) {
    win.setMinimumSize(320, 320); win.setContentSize(width, 800);
    for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark', 'warm']) {
      await run(`applyLanguage(${JSON.stringify(language)}); $('#theme').value=${JSON.stringify(theme)}; applyTheme()`);
      await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      const geometry = await run(`(() => { const header=$('.document-header'), meta=$('#document-times'); const h=header.getBoundingClientRect(), m=meta.getBoundingClientRect(); return {width:innerWidth,height:h.height,metaHeight:m.height,right:m.right,headerRight:h.right, title:meta.title, label:meta.getAttribute('aria-label'),text:meta.textContent, color:getComputedStyle(meta).color, source:payload().source}; })()`);
      assert.ok(geometry.height <= 42, JSON.stringify(geometry));
      assert.ok(geometry.metaHeight <= 24 && geometry.right <= geometry.headerRight, JSON.stringify(geometry));
      assert.equal(geometry.source, source);
      assert.ok(geometry.title.includes(language === 'en' ? 'Draft' : '草稿'));
      assert.equal(geometry.label, geometry.title);
      console.log('TIMES geometry', language, theme, JSON.stringify(geometry));
    }
  }
  }
  await run('if (!editing) toggleEditing()');
  const file = path.join(root, 'saved.md'), copy = path.join(root, 'copy.md');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  await run('saveDocument()'); await wait(`currentDocument.path === ${JSON.stringify(file)}`);
  async function checkStat(target) {
    const stat = fs.statSync(target);
    assert.deepEqual(await run('({createdAt:currentDocument.createdAt, updatedAt:currentDocument.updatedAt})'), {createdAt:stat.birthtimeMs,updatedAt:stat.mtimeMs});
    assert.equal(fs.readFileSync(target, 'utf8'), await run('payload().source'));
  }
  await checkStat(file);
  const savedTime = await run('currentDocument.updatedAt');
  await run("richEditor.editor.commands.insertContent(' second'); changed()");
  await new Promise(r => setTimeout(r, 50));
  assert.equal(await run('currentDocument.updatedAt'), savedTime, 'named dirty metadata still describes disk');
  await run('saveDocument()'); await checkStat(file);
  dialog.showSaveDialog = async () => ({ canceled: true });
  const beforeCancel = await run('JSON.stringify(currentDocument)');
  await run('saveDocument(true)'); assert.equal(await run('JSON.stringify(currentDocument)'), beforeCancel);
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: copy });
  await run('saveDocument(true)'); await checkStat(copy);
  fs.utimesSync(copy, new Date(), new Date(Date.now() - 120000));
  await run('window.mdview.reload()'); await wait('!restoringView'); await checkStat(copy);
  await openDocument(file); await wait(`currentDocument.path === ${JSON.stringify(file)} && !restoringView`); await checkStat(file);
  await openDocument(copy); await wait(`currentDocument.path === ${JSON.stringify(copy)} && !restoringView`); await checkStat(copy);
  dialog.showMessageBox = async () => ({response:1});
  for (const tab of await run('tabs.map(t=>({id:t.id}))')) await run(`window.mdview.closeTab({id:${tab.id},source:payload()?.source})`);
  await wait('currentDocument === null');
  assert.equal(await run("$('#document-times').textContent"), '');
  assert.equal(await run("$('#document-times').title"), '');
  editSession.newBlank(); await wait('currentDocument?.path === "" && editing && !restoringView');
  await run("richEditor.editor.commands.insertContent('Recovered timestamp'); changed()");
  await new Promise(r => setTimeout(r, 80));
  fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(await run('({createdAt:currentDocument.createdAt,updatedAt:currentDocument.updatedAt,source:payload().source})')));
  app.once('window-all-closed', () => console.log('TIMES write PASS', root)); win.close();
})().catch(error => { console.error(error); app.exit(1); });
