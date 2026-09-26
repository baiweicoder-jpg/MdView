// Invoked by session-restart.test.cjs in a fresh Electron process for each phase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
// Test-only reload/teardown confirmation; async window-close prompts are tested below.
dialog.showMessageBoxSync = () => 1;
const dir = process.env.MDVIEW_SESSION_TEST_DIR;
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
// Successful phases close their window and let main's normal app.quit finish.
// app.exit with a live renderer intermittently emits quit but never exits on Windows.
app.on('browser-window-created', (_event, win) => {
  // Native hide() can suspend rAF even with background throttling disabled on
  // Windows. Keep a transparent, noninteractive window shown without taking focus.
  win.hide();
  win.setOpacity(0);
  win.setFocusable(false);
  win.setIgnoreMouseEvents(true);
  win.setSkipTaskbar(true);
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
});
(async () => {
  const { win, editSession, openDocument, sessionStore } = await require('../src/main.cjs');
  win.showInactive();
  const send = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, ...args) => { if (channel === 'edit-error') console.error('EDIT ERROR', ...args); return send(channel, ...args); };
  const run = code => win.webContents.executeJavaScript(code, true);
  const a = path.join(dir, 'a.md'), b = path.join(dir, 'b.md');
  const phase = process.env.MDVIEW_SESSION_PHASE;
  const originalA = '# Original A' + '\n\nA restart scroll fixture paragraph.'.repeat(160);
  const frames = () => run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  async function waitFor(check, message) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail(`${message}: ${JSON.stringify(await run('({path:currentDocument?.path,restoringView,visibility:document.visibilityState,ready:document.readyState})'))}`);
  }
  await waitFor(() => run('!!currentDocument && !restoringView'), 'initial renderer restoration settles');
  assert.equal(await run('typeof window.mdviewPrepareClose'), 'function');
  if (phase === 'write') {
    await openDocument(a); await openDocument(b);
    const ids = await run('tabs.map(t=>({id:t.id,path:t.path}))');
    const aid = ids.find(t=>t.path===a).id;
    await run(`switchToTab(${aid})`);
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await run('toggleEditing()');
    await frames();
    assert.equal(await run('editing'), true);
    assert.ok(await run('reader.scrollHeight - reader.clientHeight > 640'), 'long fixture actually scrolls');
    await run('reader.scrollTo({top:640,behavior:"instant"})');
    await frames();
    assert.equal(await run('reader.scrollTop'), 640, 'real editor scroll position set');
    await waitFor(() => editSession.snapshot().tabs.find(tab => tab.path === a).viewState.scrollTop === 640,
      'native scroll event reaches main workspace state');
    await run(`richEditor.editor.commands.insertContent('DISCARDED SECRET'); changed()`);
    await run('new Promise(r=>setTimeout(r,50))');
    dialog.showMessageBox = async () => ({response:2});
    win.close();
    await new Promise(r=>setTimeout(r,100));
    assert.equal(win.isDestroyed(), false, 'cancel exit preserves live workspace');
    assert.equal(editSession.snapshot().tabs.length, 3);
    dialog.showMessageBox = async () => ({response:1});
    app.once('window-all-closed', () => {
      const saved = JSON.parse(fs.readFileSync(path.join(dir,'profile','session.json'),'utf8'));
      assert.equal(saved.tabs[saved.activeIndex].path,a);
      assert.ok(!JSON.stringify(saved).includes('SECRET'));
      assert.equal(fs.readFileSync(a,'utf8'),originalA);
      console.log('SESSION write PASS');
      // Let main's window-all-closed handler complete the normal quit lifecycle.
    });
    win.close();
  } else if (['missing', 'corrupt', 'blank', 'save', 'saved', 'close', 'closed'].includes(phase)) {
    const state = editSession.snapshot();
    if (phase === 'missing') {
      assert.deepEqual(state.tabs.map(t=>t.path), [path.resolve(__dirname,'../examples/欢迎使用.md'), a]);
      assert.equal(await run('currentDocument.source'), originalA);
      assert.equal(await run('reader.scrollTop'), 640, 'scroll also survives missing-tab recovery');
    } else if (phase === 'corrupt') {
      assert.equal(state.tabs.length, 1);
      assert.equal(state.tabs[0].path, path.resolve(__dirname,'../examples/欢迎使用.md'));
      assert.equal(await run('currentDocument.path'), state.tabs[0].path);
    } else if (phase === 'blank') {
      assert.deepEqual(state.tabs.map(t=>t.path), ['']);
      assert.equal(await run('currentDocument.source'), '');
      assert.equal(await run('richEditor.editor.getText()'), '');
    } else if (phase === 'save') {
      await openDocument(a);
      await waitFor(() => run('currentDocument.path === ' + JSON.stringify(a)), 'named save tab ready');
      await run(`if (!editing) toggleEditing(); richEditor.editor.commands.setContent('# Saved on exit', {contentType:'markdown'}); changed();`);
      await run('new Promise(r=>setTimeout(r,50))');
      dialog.showMessageBox = async () => ({response:0});
      app.once('window-all-closed', () => {
        assert.equal(fs.readFileSync(a,'utf8'), '# Saved on exit\n\n');
        console.log('SESSION save PASS');
      });
      win.close(); return;
    } else if (phase === 'close') {
      dialog.showMessageBox = async () => ({response:1});
      const id = await run('currentDocument.id');
      const result = await run(`window.mdview.closeTab({id:${id},source:'DISCARDED TAB SECRET'})`);
      assert.equal(result.ok,true);
      assert.deepEqual(editSession.snapshot().tabs.map(t=>t.path),['']);
      assert.equal(await run('currentDocument.path'),'');
      assert.equal(fs.readFileSync(a,'utf8'),'# Saved on exit\n\n');
    } else if (phase === 'closed') {
      assert.deepEqual(state.tabs.map(t=>t.path),['']);
      assert.equal(await run('currentDocument.source'),'');
    } else {
      assert.equal(await run('currentDocument.source'), '# Saved on exit\n\n');
    }
    sessionStore.flush();
    app.once('window-all-closed', () => console.log(`SESSION ${phase} PASS`));
    win.close();
  } else {
    const state = editSession.snapshot();
    assert.deepEqual(state.tabs.map(t=>t.path), [path.resolve(__dirname,'../examples/欢迎使用.md'), a, b]);
    assert.equal(state.tabs[state.activeIndex].path, phase === 'cli' ? b : a);
    assert.deepEqual(state.tabs[1].viewState,{scrollTop:640,editing:true});
    if (phase !== 'cli') {
      assert.equal(await run('editing'), true, 'actual editor mode restores');
      assert.equal(await run('reader.scrollTop'), 640, 'actual nonzero editor scroll restores after restart');
      await frames();
      assert.equal(await run('reader.scrollTop'), 640, 'editor focus does not reset restored scroll');
    }
    assert.equal(await run('currentDocument.source'),phase === 'cli' ? '# Original B' : originalA);
    assert.ok(!JSON.stringify(state).includes('SECRET'));
    sessionStore.flush();
    app.once('window-all-closed', () => console.log(`SESSION ${phase} PASS`));
    win.close();
  }
})().catch(error => {console.error(error);app.exit(1);});
