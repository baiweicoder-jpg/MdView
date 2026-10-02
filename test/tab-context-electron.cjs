const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { app, Menu, shell, clipboard, ClipboardItem } = require('electron');
const root = process.env.MDVIEW_TAB_DIR || fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-tab-menu-'));
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
process.on('uncaughtException', e => { console.error(e); app.exit(1); });
app.on('browser-window-created', (_e, win) => { win.setOpacity(0); win.webContents.setBackgroundThrottling(false); win.show(); });
(async () => {
  const { win, editSession, openDocument, sessionStore } = await require('../src/main.cjs');
  // Disable throttling on the loaded renderer as well as the native window.
  win.webContents.setBackgroundThrottling(false);
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for(let i=0;i<200;i++) { if(await run(code)) return; await new Promise(r=>setTimeout(r,25)); } assert.fail(code); };
  await wait('!!currentDocument && !restoringView');
  assert.equal(await run('typeof window.mdview.popupTabMenu'), 'function', 'tab menu bridge exists');
  if (process.env.MDVIEW_TAB_PHASE === 'read') {
    const expected = JSON.parse(fs.readFileSync(path.join(root,'expected.json')));
    assert.equal(await run('currentDocument.path'), expected.path);
    assert.equal(await run('payload().source'), expected.source);
    assert.equal(await run('tabs.filter(t=>t.path===currentDocument.path).length'), 1);
    assert.equal(await run("!!document.querySelector('#editor-content img[src^=\"data:\"]')"), true);
    console.log('TAB CONTEXT restart PASS'); win.destroy(); app.exit(0); return;
  }
  const first = path.join(root, 'first 中文.md'), second = path.join(root, 'other.md');
  fs.writeFileSync(first, '# Disk\n\n![relative](pixel.png)\n');
  fs.writeFileSync(second, '# Other\n');
  fs.writeFileSync(path.join(root, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXsAAAAASUVORK5CYII=', 'base64'));
  await openDocument(first); await wait(`currentDocument.path === ${JSON.stringify(first)} && !restoringView`);
  const firstId = await run('currentDocument.id');
  await run("toggleEditing(); richEditor.editor.commands.insertContent('draft A '); changed()");
  const firstDraft = await run('payload().source');
  await openDocument(second); await wait(`currentDocument.path === ${JSON.stringify(second)} && !restoringView`);
  const secondId = await run('currentDocument.id');
  await run("toggleEditing(); richEditor.editor.commands.insertContent('draft B '); changed()");
  const secondDraft = await run('payload().source');
  const action = async (id, action) => run(`window.mdview.tabFileAction({id:${id},action:${JSON.stringify(action)}})`);
  const beginRename = async id => {
    await run(`void window.mdview.tabFileAction({id:${id},action:'rename'}).then(r=>window.renameResult=r)`);
    await wait("$('#rename-dialog').open");
  };
  const submit = async name => { await run(`$('#rename-name').value=${JSON.stringify(name)}; $('#rename-dialog form').requestSubmit()`); };
  const cancel = async () => { await run("$('#rename-dialog [data-cancel]').click()"); await wait('!fileBusy'); };
  let nativeMenu;
  const originalPopup = Menu.prototype.popup;
  const originalReveal = shell.showItemInFolder;
  const savedClipboard = await clipboard.read();
  try {
    // Observe real native Menu.popup, do not replace its implementation. Invoke
    // its real item callback to exercise selection without OS-coordinate flakiness.
    Menu.prototype.popup = function(options) { nativeMenu = this; return originalPopup.call(this, options); };
    const point = await run(`(() => {const r=document.querySelector('.tab[data-id="${firstId}"] .tab-name').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    win.focus();
    win.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});
    for(let i=0;i<100&&!nativeMenu;i++) await new Promise(r=>setTimeout(r,25));
    assert.ok(nativeMenu, 'real right mouse button opened native tab menu');
    assert.deepEqual(nativeMenu.items.map(i=>i.label), ['复制文件全路径','打开所在文件夹','重命名']);
    assert.equal(await run('currentDocument.id'), secondId, 'inactive right click never switches');
    nativeMenu.getMenuItemById('copy-path').click(); nativeMenu.closePopup(win);
    await wait('!fileBusy');
    for(let i=0;i<100&&(await clipboard.readText())!==first;i++) await new Promise(r=>setTimeout(r,25));
    assert.equal(await clipboard.readText(), first, 'real Electron44 async clipboard');
    const sidebarMenu = async (id, choice, keyboard = false) => {
      nativeMenu = null;
      await run("$('#sidebar-tab-files').click()");
      const selector = `#opened-files-list .sidebar-file[data-id="${id}"]`;
      if (keyboard) {
        await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);
        win.focus();
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'F10',modifiers:['shift']});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'F10',modifiers:['shift']});
      } else {
        const point = await run(`(() => {const r=document.querySelector(${JSON.stringify(selector + ' .tab-name')}).getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
        win.focus();
        win.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});
        win.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});
      }
      for(let i=0;i<100&&!nativeMenu;i++) await new Promise(r=>setTimeout(r,25));
      assert.ok(nativeMenu, 'sidebar item opens the real native file menu');
      assert.deepEqual(nativeMenu.items.filter(i=>i.id).map(i=>i.id), ['copy-path','reveal','rename']);
      if (choice) nativeMenu.getMenuItemById(choice).click();
      nativeMenu.closePopup(win);
    };
    // The preceding tab action already copied this same path. Clear it so a
    // stale clipboard cannot pass before the sidebar menu's asynchronous
    // close callback -> renderer IPC -> file action has actually completed.
    await clipboard.clear();
    await sidebarMenu(firstId, 'copy-path');
    for(let i=0;i<100&&(await clipboard.readText())!==first;i++) await new Promise(r=>setTimeout(r,25));
    assert.equal(await clipboard.readText(), first);
    await wait('!fileBusy');
    assert.equal(await run('currentDocument.id'), secondId, 'sidebar right click does not activate the target');
    let revealed;
    shell.showItemInFolder = file => { revealed = file; };
    await sidebarMenu(firstId, 'reveal', true);
    for(let i=0;i<100&&!revealed;i++) await new Promise(r=>setTimeout(r,25));
    await wait('!fileBusy');
    assert.equal(revealed, first);
    assert.equal(await run('payload().source'), secondDraft);
    await sidebarMenu(firstId, 'rename');
    await wait("$('#rename-dialog').open");
    const { dialog } = require('electron');
    const originalOpen = dialog.showOpenDialog; let openedDuringRename = false;
    dialog.showOpenDialog = async () => { openedDuringRename = true; return {canceled:true,filePaths:[]}; };
    try {
      win.focus(); win.webContents.sendInputEvent({type:'keyDown',keyCode:'o',modifiers:['control']}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'o',modifiers:['control']});
      await new Promise(r=>setTimeout(r,100));
      assert.equal(openedDuringRename,false,'rename modal suspends native application shortcuts');
    } finally { dialog.showOpenDialog = originalOpen; }
    assert.deepEqual(await run("({v:$('#rename-name').value,a:$('#rename-name').selectionStart,b:$('#rename-name').selectionEnd})"), {v:'first 中文.md',a:0,b:'first 中文'.length});
    for (const invalid of ['CON.md','../oops.md','bad?.md','bad.md ','bad.md.','', 'wrong.txt', 'other.md']) {
      await submit(invalid); await wait("$('#rename-dialog').open && !$('#rename-error').hidden");
      assert.ok(fs.existsSync(first)); assert.equal(fs.readFileSync(second,'utf8'),'# Other\n');
    }
    await cancel(); assert.equal(await run('payload().source'), secondDraft);
    // Filtering rebuilds the rows; delegated menus still address the stable ID.
    await run("$('#opened-files-search').value='first'; $('#opened-files-search').dispatchEvent(new Event('input'))");
    await sidebarMenu(firstId, 'rename');
    await wait("$('#rename-dialog').open");
    const renamed = path.join(root, '新 filename.markdown');
    await run("$('#rename-name').select()");
    win.webContents.insertText(path.basename(renamed));
    await wait(`$('#rename-name').value === ${JSON.stringify(path.basename(renamed))}`);
    const submitPoint = await run("(() => { const r=$('#rename-dialog [type=submit]').getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })()");
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...submitPoint}); win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...submitPoint});
    await wait('!fileBusy');
    assert.equal(fs.existsSync(first), false); assert.equal(fs.readFileSync(renamed,'utf8'),'# Disk\n\n![relative](pixel.png)\n');
    assert.equal(await run('currentDocument.id'), secondId); assert.equal(await run('payload().source'), secondDraft);
    assert.equal(await run(`tabs.find(t=>t.id===${firstId}).dirty`), true);
    assert.equal(editSession.snapshot().tabs.find(t=>t.path===renamed).path, renamed);
    await run("$('#opened-files-search').value=''; $('#opened-files-search').dispatchEvent(new Event('input'))");
    assert.equal(await run(`document.querySelector('#opened-files-list .sidebar-file[data-id="${firstId}"]').title`), renamed);
    assert.equal(await run(`document.querySelector('#opened-files-list .sidebar-file[data-id="${firstId}"]').classList.contains('dirty')`), true);
    await run(`switchToTab(${firstId})`); await wait('!restoringView');
    assert.equal(await run('payload().source'), firstDraft);
    assert.equal(await run("richEditor.editor.getText().includes('draft A')"), true);
    assert.equal(await run('currentDocument.path'), renamed);
    assert.ok(await run("!!document.querySelector('#editor-content img[src^=\"data:\"]')"), 'approved relative image survives');
    // Active rename preserves editor/history object and draft, without remount.
    await run('void (window.originalEditor=richEditor.editor)');
    await beginRename(firstId); await run("$('#rename-name').value='active.md'; $('#rename-name').focus()");
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'}); await wait('!fileBusy');
    const activePath = path.join(root,'active.md');
    assert.equal(await run('currentDocument.path'), activePath);
    assert.equal(await run('richEditor.editor === window.originalEditor'), true);
    assert.equal(await run('payload().source'), firstDraft);
    assert.equal(await run("$('#file-path').textContent"), activePath);
    assert.equal(await run('tabs.find(t=>t.active).dirty'), true);
    await run('saveDocument()'); await wait('!fileBusy'); assert.equal(fs.readFileSync(activePath,'utf8'), firstDraft);
    assert.equal(fs.existsSync(renamed), false);
    // Cancellation via X and actual Escape; case-only and external-change errors.
    await beginRename(firstId); win.focus(); win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'}); await wait('!fileBusy');
    await beginRename(firstId); await submit('ACTIVE.md'); await wait("$('#rename-dialog').open && !$('#rename-error').hidden"); await cancel();
    fs.writeFileSync(activePath, '# externally changed');
    await beginRename(firstId); await submit('blocked.md'); await wait("$('#rename-dialog').open && !$('#rename-error').hidden"); await cancel();
    assert.equal(fs.readFileSync(activePath,'utf8'), '# externally changed'); assert.equal(fs.existsSync(path.join(root,'blocked.md')),false);
    fs.unlinkSync(activePath); assert.equal((await action(firstId,'reveal')).ok,false);
    fs.writeFileSync(activePath, firstDraft);
    // English and all theme / narrow modal geometry.
    await run("window.mdview.setLanguage('en')");
    for(const theme of ['light','dark','warm']) {
      win.setMinimumSize(320,320); win.setContentSize(360,650);
      await run(`$('#theme').value=${JSON.stringify(theme)}; applyTheme()`);
      await beginRename(firstId);
      assert.equal(await run("$('#rename-title').textContent"),'Rename file');
      assert.equal(await run("(() => {const r=$('#rename-dialog').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && $('#rename-dialog').scrollWidth<=$('#rename-dialog').clientWidth})()"),true);
      await cancel();
    }
    // Untitled disables every file action, no fabricated path.
    editSession.newBlank(); await wait("currentDocument?.path === '' && !restoringView");
    const blankId = await run('currentDocument.id'); nativeMenu = null;
    await run(`void window.mdview.popupTabMenu({id:${blankId},point:{x:20,y:50}})`);
    for(let i=0;i<100&&!nativeMenu;i++) await new Promise(r=>setTimeout(r,25));
    assert.equal(nativeMenu.items.every(i=>!i.enabled),true); nativeMenu.closePopup(win);
    await sidebarMenu(blankId, null, true);
    assert.equal(nativeMenu.items.every(i=>!i.enabled),true, 'sidebar untitled actions require saving first');
    assert.equal((await action(blankId,'copy-path')).ok,false);
    // Actual keyboard-triggered native popup.
    nativeMenu=null;
    await run(`document.querySelector('.tab[data-id="${blankId}"]').focus()`);
    win.focus(); win.webContents.sendInputEvent({type:'keyDown',keyCode:'F10',modifiers:['shift']}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'F10',modifiers:['shift']});
    for(let i=0;i<100&&!nativeMenu;i++) await new Promise(r=>setTimeout(r,25));
    assert.ok(nativeMenu,'Shift+F10 native popup'); nativeMenu.closePopup(win);
    await assert.rejects(action(999999,'copy-path'));
    await assert.rejects(action(firstId,'execute'));
    await run(`switchToTab(${firstId})`); await wait('!restoringView');
    fs.writeFileSync(path.join(root,'expected.json'), JSON.stringify({path:activePath,source:firstDraft}));
    sessionStore.flush();
    assert.ok(JSON.parse(fs.readFileSync(path.join(root,'profile','session.json'))).tabs.some(t=>t.path===activePath));
    console.log('TAB CONTEXT native mouse/menu, clipboard, reveal, inactive+active drafts, filename validation, real disk move/save, images, modal Escape/X, narrow themes, keyboard and recovery metadata PASS');
  } finally {
    Menu.prototype.popup = originalPopup; shell.showItemInFolder = originalReveal;
    if (savedClipboard.length) {
      const items=[];
      for(const item of savedClipboard) { const values={}; for(const type of item.types) values[type]=await item.getType(type); items.push(new ClipboardItem(values)); }
      await clipboard.write(items);
    } else clipboard.clear();
  }
  win.destroy(); app.exit(0);
})().catch(e => {console.error(e); app.exit(1);});
