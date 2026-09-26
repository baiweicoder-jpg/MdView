const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, nativeImage } = require('electron');
const dir = process.env.MDVIEW_SESSION_TEST_DIR;
const phase = process.env.MDVIEW_SESSION_PHASE;
app.setPath('userData', path.join(dir,'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0); win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
  win.webContents.setBackgroundThrottling(false); win.showInactive();
});
const sources = ['# 中文 🐋\n\n**粗体** 和 *斜体*\n\n- [x] 完成\n', '## 日本語 café\n\n```js\nconst x = "🐋";\n```\n\n最后一笔'];
(async () => {
  const {win,editSession,sessionStore} = await require('../src/main.cjs');
  win.showInactive();
  const run = code => win.webContents.executeJavaScript(code,true);
  const wait = async check => { for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,25));}assert.fail('renderer did not settle'); };
  await wait(()=>run('!!currentDocument && !restoringView'));
  assert.equal(await run('typeof window.mdviewPrepareClose'), 'function');
  dialog.showMessageBox = async () => assert.fail('untitled window exit must not prompt');
  dialog.showMessageBoxSync = () => assert.fail('window exit must not invoke reload confirmation');
  if(phase === 'draft-write') {
    for(const source of sources) {
      await run('window.mdview.newDocument()');
      await wait(()=>run('currentDocument?.path === "" && editing && !restoringView'));
      await run(`richEditor.editor.commands.setContent(${JSON.stringify(source)}, {contentType:'markdown'}); changed()`);
      await wait(()=>editSession.snapshot().tabs.at(-1).source?.includes(source.includes('中文')?'中文':'日本語'));
    }
    const expected = [];
    const ids = await run('tabs.filter(t=>!t.path).map(t=>t.id)');
    for(const id of ids) { await run(`switchToTab(${id})`); await wait(()=>run('!restoringView')); expected.push(await run('payload().source')); }
    // Suppress update IPC for the last edit: only the close round trip can capture it.
    await run(`richEditor.editor.commands.setContent(${JSON.stringify(sources[1] + ' Ω')}, {contentType:'markdown',emitUpdate:false}); true`);
    const png = nativeImage.createFromBitmap(Buffer.alloc(64 * 32 * 4, 160), {width:64,height:32}).toDataURL();
    await run(`{const json=richEditor.editor.getJSON();json.content.push({type:'paragraph',content:[{type:'image',attrs:{src:${JSON.stringify(png)},alt:'restart one',width:192}},{type:'text',text:' '},{type:'image',attrs:{src:${JSON.stringify(png)},alt:'restart two',width:96}}]});richEditor.editor.commands.setContent(json,{emitUpdate:false});} true`);
    expected[1] = await run('payload().source');
    assert.notEqual(editSession.snapshot().tabs.at(-1).source,expected[1]);
    fs.writeFileSync(path.join(dir,'expected.json'),JSON.stringify(expected));
  } else {
    const expected = JSON.parse(fs.readFileSync(path.join(dir,'expected.json'),'utf8'));
    assert.deepEqual(editSession.snapshot().tabs.filter(t=>!t.path).map(t=>t.source),expected);
    assert.equal(editSession.snapshot().activeIndex,2);
    assert.equal(await run('payload().source'),expected[1]);
    assert.equal(await run('editing'),true);
    await wait(()=>run("[...richEditor.editor.view.dom.querySelectorAll('.editor-image img')].every(i=>i.naturalWidth===64)"));
    assert.deepEqual(await run("[...richEditor.editor.view.dom.querySelectorAll('.editor-image img')].map(i=>i.getBoundingClientRect().width)"),[192,96], 'separate-process restart preserves resized embedded images');
    assert.match(expected[1], /\{width=192\}.*\{width=96\}/);
    assert.equal(await run('tabs.filter(t=>!t.path).every(t=>t.dirty)'),true);
    const ids = await run('tabs.filter(t=>!t.path).map(t=>t.id)');
    dialog.showMessageBox = async()=>({response:2});
    assert.equal((await run(`window.mdview.closeTab({id:${ids[0]},source:payload().source})`)).canceled,true);
    assert.equal(editSession.snapshot().tabs.length,3);
    dialog.showMessageBox = async()=>({response:1});
    assert.equal((await run(`window.mdview.closeTab({id:${ids[0]},source:payload().source})`)).ok,true);
    dialog.showSaveDialog = async()=>({canceled:true});
    assert.equal((await run('window.mdview.save({...payload(),asNew:false})')).canceled,true);
    assert.equal(editSession.snapshot().tabs.at(-1).source,expected[1]);
    const saved = path.join(dir,'saved.md');
    dialog.showSaveDialog = async()=>({canceled:false,filePath:saved});
    assert.equal((await run('window.mdview.save({...payload(),asNew:false})')).ok,true);
    assert.equal(fs.readFileSync(saved,'utf8'),expected[1]);
    assert.equal(editSession.snapshot().tabs.filter(t=>!t.path).length,0);
    // Recreate a dirty untitled and make the target a directory: atomic rename fails.
    await run('window.mdview.newDocument()');
    await wait(()=>run('currentDocument?.path === "" && !restoringView'));
    await run('richEditor.editor.commands.insertContent("恢复失败仍然保留"); changed()');
    const sessionFile=path.join(dir,'profile','session.json');
    sessionStore.flush(); fs.unlinkSync(sessionFile); fs.mkdirSync(sessionFile);
    win.close();
    await wait(()=>run('!fileBusy'));
    assert.equal(win.isDestroyed(),false,'failed persistence blocks exit');
    assert.ok(editSession.snapshot().tabs.at(-1).source.includes('恢复失败'));
    fs.rmdirSync(sessionFile);
    dialog.showMessageBox = async()=>assert.fail('untitled exit prompted');
  }
  app.once('window-all-closed',()=>{
    const disk=JSON.parse(fs.readFileSync(path.join(dir,'profile','session.json'),'utf8'));
    if(phase==='draft-read') {assert.equal(disk.tabs.filter(t=>!t.path).length,1); assert.ok(!disk.tabs.some(t=>t.source?.includes('中文')));}
    console.log(`SESSION ${phase} PASS`);
  });
  win.close();
})().catch(error=>{console.error(error);app.exit(1);});
