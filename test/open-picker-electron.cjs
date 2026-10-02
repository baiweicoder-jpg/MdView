const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');
const root = process.env.MDVIEW_PICKER_DIR || fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-open-picker-'));
const folder = path.join(root, '保存 文件夹');
fs.mkdirSync(folder, {recursive:true});
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0); win.setFocusable(false); win.setSkipTaskbar(true);
  win.webContents.setBackgroundThrottling(false); win.showInactive();
});
(async () => {
  const originalOpen = dialog.showOpenDialog;
  let win;
  try {
    ({ win } = await require('../src/main.cjs'));
    // Disable throttling on the loaded renderer as well as the native window.
    win.webContents.setBackgroundThrottling(false);
    const run = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => { for (let i = 0; i < 200; i++) { if (await run(code)) return; await new Promise(r => setTimeout(r, 20)); } assert.fail(code); };
    await wait('!!currentDocument && !restoringView');
    if (process.env.MDVIEW_PICKER_PHASE === 'read') {
      const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')));
      assert.deepEqual(await run('tabs.map(t=>t.path)'), expected.paths);
      assert.equal(await run('currentDocument.path'), '');
      assert.equal(await run('payload().source'), expected.source);
      assert.equal(await run('richEditor.editor.getText()'), 'Untitled surviving batch 中文');
      dialog.showOpenDialog = async (_win, options) => { assert.equal(options.defaultPath, folder); return {canceled:true,filePaths:[]}; };
      await run('window.mdview.open()');
      console.log('OPEN PICKER read PASS: fresh process restores 100 ordered tabs, active untitled draft, configured folder');
      const closed = new Promise(resolve => win.once('closed', resolve)); win.close(); await closed;
      return;
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    await run('window.mdview.chooseSaveDirectory()');
    let options;
    dialog.showOpenDialog = async (_win, value) => { options = value; return { canceled: true, filePaths: [] }; };
    const before = await run('JSON.stringify({tabs,source:payload().source})');
    await run('window.mdview.open()');
    assert.deepEqual(options, { title: '打开 Markdown', defaultPath: folder, properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }] });
    assert.equal(await run('JSON.stringify({tabs,source:payload().source})'), before);
    console.log('OPEN PICKER PASS: configured Unicode/spaces directory, exact options, cancel');
    const files = ['first.md', 'second.markdown'].map(name => path.join(folder, name));
    files.forEach((file, i) => fs.writeFileSync(file, `# Actual document ${i}\n\nDisk body ${i}\n`));
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
    await run('window.mdview.open()');
    await wait('!restoringView');
    assert.deepEqual(await run('tabs.slice(-2).map(t=>t.path)'), files);
    assert.equal(await run('currentDocument.path'), files[1]);
    assert.match(await run("$('#content').textContent"), /Disk body 1/);
    for (const file of files) {
      await run(`switchToTab(tabs.find(t=>t.path===${JSON.stringify(file)}).id)`);
      await wait('!restoringView');
      await run('if (!editing) toggleEditing()');
      assert.match(await run('richEditor.editor.getText()'), new RegExp(`Disk body ${files.indexOf(file)}`));
    }
    console.log('OPEN PICKER PASS: actual Markdown files, ordered tabs and real editor bodies');
    const select = async paths => {
      dialog.showOpenDialog = async () => ({canceled:false, filePaths:paths});
      const result = await run('window.mdview.open()');
      await wait('!restoringView && !fileBusy');
      return result;
    };
    const switchFile = async file => {
      await run(`switchToTab(tabs.find(t=>t.path===${JSON.stringify(file)}).id)`);
      await wait('!restoringView && !fileBusy');
    };
    // Suppress update callbacks to exercise capture of a genuinely unsent last edit.
    await run("richEditor.editor.commands.insertContent(' unsent saved draft', {emitUpdate:false})");
    const namedDraft = await run('payload().source');
    await select([files[0], files[1], files[1].toUpperCase()]);
    assert.equal(await run('tabs.length'), 3, 'case variants and repeats do not duplicate tabs');
    assert.equal(await run('payload().source'), namedDraft);
    assert.equal(await run('tabs.find(t=>t.active).dirty'), true);
    assert.equal(fs.readFileSync(files[1], 'utf8'), '# Actual document 1\n\nDisk body 1\n');
    await run('window.mdview.newDocument()');
    await wait('currentDocument.path === "" && editing && !restoringView');
    await run("richEditor.editor.commands.insertContent('Untitled surviving batch 中文', {emitUpdate:false})");
    const untitled = await run('({id:currentDocument.id,source:payload().source})');
    const third = path.join(folder, 'third.md'); fs.writeFileSync(third, '# Third real file\n');
    await select([files[0], third]);
    await run(`switchToTab(${untitled.id})`); await wait('!restoringView');
    assert.equal(await run('richEditor.editor.getText()'), 'Untitled surviving batch 中文');
    assert.equal(await run('payload().source'), untitled.source);
    await switchFile(files[1]);
    assert.equal(await run('payload().source'), namedDraft, 'inactive dirty named tab survives');
    const stable = await run('JSON.stringify({tabs,source:payload().source})');
    dialog.showOpenDialog = async () => ({canceled:true,filePaths:[third]});
    await run('window.mdview.open()');
    assert.equal(await run('JSON.stringify({tabs,source:payload().source})'), stable);
    await select([]);
    assert.equal(await run('JSON.stringify({tabs,source:payload().source})'), stable);
    console.log('OPEN PICKER PASS: Windows dedup, named/untitled unsent drafts, cancel and empty selection');
    const bad = path.join(folder, 'invalid.txt'), missing = path.join(folder, 'missing.md');
    const encoding = path.join(folder, 'invalid-utf8.md'); fs.writeFileSync(encoding, Buffer.from([0xff,0xfe]));
    const directory = path.join(folder, 'not-file.md'); fs.mkdirSync(directory);
    const oversized = path.join(folder, 'oversized.md'); fs.writeFileSync(oversized, Buffer.alloc(10 * 1024 * 1024 + 1));
    await run("window.mdview.setLanguage('en')");
    const mixed = await select([bad, missing, encoding, directory, oversized, third]);
    assert.equal(mixed.ok, false); assert.equal(mixed.errors.length, 5);
    assert.deepEqual(mixed.opened, [third]);
    assert.equal(await run('currentDocument.path'), third);
    const notice = await run("({text:$('#notice').textContent, hidden:$('#notice').hidden})");
    assert.equal(notice.hidden, false);
    for (const file of [bad, missing, encoding, directory, oversized]) assert.ok(notice.text.includes(file));
    assert.match(notice.text, /does not exist|moved/);
    assert.match(await run("$('#content').textContent"), /Third real file/);
    const allInvalidState = await run('JSON.stringify({tabs,source:payload().source})');
    await select([missing, bad]);
    assert.equal(await run('JSON.stringify({tabs,source:payload().source})'), allInvalidState);
    console.log('OPEN PICKER PASS: per-file extension/missing/encoding/directory/size errors, later valid success, visible aggregate');
    // Missing configured folders must not be recreated; unset uses native default.
    const gone = path.join(root, 'removed folder'); fs.mkdirSync(gone);
    dialog.showOpenDialog = async () => ({canceled:false,filePaths:[gone]});
    await run('window.mdview.chooseSaveDirectory()'); fs.rmdirSync(gone);
    dialog.showOpenDialog = async (_win, value) => { options=value; return {canceled:true,filePaths:[]}; };
    await run('window.mdview.open()'); assert.equal(Object.hasOwn(options, 'defaultPath'), false);
    assert.equal(fs.existsSync(gone), false);
    await run('window.mdview.resetSaveDirectory()');
    await run('window.mdview.open()'); assert.equal(Object.hasOwn(options, 'defaultPath'), false);
    assert.equal(options.title, 'Open Markdown');
    console.log('OPEN PICKER PASS: missing/unset folder native fallback, no mkdir, English title');
    const count = await run('tabs.length');
    const capacityFiles = Array.from({length:100-count}, (_,i) => path.join(folder, `capacity-${i}.md`));
    capacityFiles.forEach((file,i) => fs.writeFileSync(file, `# Capacity ${i}\n`));
    await select(capacityFiles);
    assert.equal(await run('tabs.length'), 100);
    const excess = path.join(folder, 'excess.md'); fs.writeFileSync(excess, '# Excess\n');
    const capped = await select([excess, files[0]]);
    assert.equal(capped.errors.length, 1); assert.match(capped.errors[0], /100/);
    assert.match(capped.errors[0], /Close a tab/);
    assert.equal(await run('tabs.length'), 100);
    assert.equal(await run('currentDocument.path'), files[0], 'existing file can still be switched at capacity');
    assert.equal(await run('tabs.some(t=>t.path === '+JSON.stringify(excess)+')'), false);
    console.log('OPEN PICKER PASS: real 100-tab capacity, later existing tab still activates');
    await switchFile(files[1]); await run('saveDocument()');
    assert.equal(fs.readFileSync(files[1], 'utf8'), namedDraft);
    await run(`switchToTab(${untitled.id})`); await wait('!restoringView && !fileBusy');
    dialog.showOpenDialog = async () => ({canceled:false,filePaths:[folder]});
    await run('window.mdview.chooseSaveDirectory()');
    fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify({paths:await run('tabs.map(t=>t.path)'),source:untitled.source}));
    const closed = new Promise(resolve => win.once('closed', resolve)); win.close(); await closed;
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'profile', 'session.json')));
    assert.equal(saved.tabs.length, 100);
    assert.equal(saved.tabs[saved.activeIndex].source, untitled.source);
    console.log('OPEN PICKER write PASS: real window close commits ordered workspace and active draft');
  } finally {
    dialog.showOpenDialog = originalOpen;
    if (win && !win.isDestroyed()) win.destroy();
    // Chromium holds profile locks until process exit; scratch retention handles cleanup.
  }
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
