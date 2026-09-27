const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');
const scratch = process.env.TMPDIR || app.getPath('temp');
const dir = fs.mkdtempSync(path.join(scratch, 'mdview-unsaved-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => { win.webContents.setBackgroundThrottling(false); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const { win, editSession, openDocument } = await require('../src/main.cjs');
  const run = code => win.webContents.executeJavaScript(code, true);
  async function waitFor(code) { for (let i=0;i<200;i++) { if (await run(code)) return; await delay(20); } throw Error(`Timed out: ${code}`); }
  if (process.argv.includes('--inject')) {
    await run(`(() => { const link=document.createElement('link'); link.rel='stylesheet';link.href='confirm-dialog.css';document.head.append(link);const script=document.createElement('script');script.src='confirm-dialog.js';document.body.append(script); })()`);
    await waitFor("!!document.querySelector('#unsaved-dialog')");
  }
  assert.equal(await run("!!document.querySelector('script[src=\"confirm-dialog.js\"]') && !!document.querySelector('link[href=\"confirm-dialog.css\"]')"), true, 'production entry wires custom confirmation assets');
  await waitFor('!!currentDocument && !restoringView');
  let lastQuestion;
  const send = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, ...args) => { if(channel === 'unsaved-confirm') lastQuestion=args[0];return send(channel,...args); };
  dialog.showMessageBox = async () => assert.fail('custom path must not use native dialog');
  const fixture=path.join(dir,'资源网站 🧪.md');
  fs.writeFileSync(fixture,'# Original\n');
  await openDocument(fixture); await waitFor(`currentDocument?.path===${JSON.stringify(fixture)}`);
  await run("if(!editing) toggleEditing(); richEditor.editor.commands.insertContent('UNSAVED'); changed()");
  await delay(60);
  const originalSource = await run('payload().source');
  async function startClose() {
    await run("window.closeResult=null; window.promptFocus=document.activeElement; void window.mdview.closeTab(payload()).then(result=>window.closeResult=result)");
    await waitFor("!!document.querySelector('#unsaved-dialog[open]')");
  }
  async function pointer(choice) {
    const point=await run(`(() => { const r=document.querySelector('#unsaved-dialog ${choice}').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
  }
  const key = (keyCode, modifiers=[]) => { win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers}); };
  for(const choice of ['.unsaved-actions [data-choice="cancel"]','.unsaved-x','Escape']) {
    await startClose();
    assert.equal(await run("document.activeElement===document.querySelector('#unsaved-dialog [autofocus]')"),true,'safe default');
    for(let i=0;i<6;i++) key('Tab');
    await delay(30); assert.equal(await run("document.querySelector('#unsaved-dialog').contains(document.activeElement)"),true,'forward trap');
    key('Tab',['shift']); await delay(30); assert.equal(await run("document.querySelector('#unsaved-dialog').contains(document.activeElement)"),true,'reverse trap');
    if(choice==='Escape') key('Escape');else await pointer(choice);
    await waitFor('closeResult !== null && !fileBusy');
    assert.equal(await run('closeResult.canceled'),true);
    assert.equal(await run('document.activeElement===window.promptFocus'),true,'focus restored');
    assert.equal(await run('payload().source'),originalSource);
    assert.equal(await run('tabs.find(t=>t.active).dirty'),true);
  }
  const originalSync=dialog.showMessageBoxSync;let syncCalls=0;
  dialog.showMessageBoxSync=()=>{syncCalls++;return 0;};
  win.webContents.reload();await delay(150);
  dialog.showMessageBoxSync=originalSync;
  assert.equal(syncCalls,1,'dirty renderer reload retains native synchronous guard');
  assert.equal(await run('payload().source'),originalSource);
  await run('window.reloadDone=false;void window.mdview.reload().then(()=>window.reloadDone=true)');
  await waitFor("!!document.querySelector('#unsaved-dialog[open]')");
  await pointer('.unsaved-actions [data-choice="cancel"]');await waitFor('reloadDone && !fileBusy');
  assert.equal(await run('payload().source'),originalSource,'named reread cancel preserves draft');
  await startClose();
  const invalid={id:'wrong-id',choice:'discard'};
  await run(`window.mdview.answerUnsavedConfirm(${JSON.stringify(invalid.id)},${JSON.stringify(invalid.choice)})`);
  await run(`window.mdview.answerUnsavedConfirm(${JSON.stringify(lastQuestion.id)},'bogus')`);
  ipcMain.emit('unsaved-confirm-answer',{sender:null,senderFrame:null},{id:lastQuestion.id,choice:'discard'});
  await delay(40);assert.equal(await run('closeResult'),null,'invalid and untrusted answers ignored');
  const colors=[];
  for(const theme of ['light','dark','warm']) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.querySelector('#unsaved-name').textContent=${JSON.stringify(lastQuestion.name)}`);
    colors.push(await run("getComputedStyle(document.querySelector('#unsaved-dialog')).backgroundColor"));
    const artifactDir=path.resolve('artifacts/desktop');fs.mkdirSync(artifactDir,{recursive:true});
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    fs.writeFileSync(path.join(artifactDir,`unsaved-${theme}.png`),(await win.webContents.capturePage()).toPNG());
    await run(`document.querySelector('#unsaved-name').textContent=${JSON.stringify('很长的文件名🧪<img src=x>'.repeat(30)+'.md')}`);
    assert.equal(await run("document.querySelector('#unsaved-name img')===null"),true);
    assert.equal(await run("document.querySelector('#unsaved-dialog').scrollWidth<=document.querySelector('#unsaved-dialog').clientWidth"),true);
  }
  assert.equal(new Set(colors).size,3);
  win.setMinimumSize(300,300);win.setSize(340,520);await delay(80);
  assert.equal(await run("document.querySelector('#unsaved-dialog').getBoundingClientRect().right<=innerWidth"),true,'narrow viewport');
  await pointer('.unsaved-actions [data-choice="cancel"]');await waitFor('!fileBusy');win.setSize(1220,860);
  // Named save failure: disk conflict must keep the tab dirty and original draft intact.
  fs.writeFileSync(fixture,'# External change\n');
  await startClose();await pointer('[data-choice="save"]');await waitFor('closeResult !== null && !fileBusy');
  assert.equal(await run('closeResult.ok'),false);assert.equal(await run('payload().source'),originalSource);
  assert.equal(await run('tabs.find(t=>t.active).dirty'),true);
  await run('window.wrapperDone=false;void closeTab(currentDocument.id).then(()=>window.wrapperDone=true)');
  await waitFor("!!document.querySelector('#unsaved-dialog[open]')");
  await pointer('[data-choice="save"]');await waitFor('wrapperDone && !fileBusy');
  assert.equal(await run("!document.querySelector('#notice').hidden && document.querySelector('#notice').textContent.includes('文件')"),true,'failed close-save is visible to user');
  await startClose();await pointer('[data-choice="discard"]');await waitFor('closeResult?.ok === true && !fileBusy');
  assert.equal(fs.readFileSync(fixture,'utf8'),'# External change\n');
  // Successful save follows the ordinary atomic save path.
  await openDocument(fixture);await waitFor(`currentDocument?.path===${JSON.stringify(fixture)}`);
  await run("if(!editing) toggleEditing();richEditor.editor.commands.insertContent('SAVED');changed()");await delay(40);
  const saved=await run('payload().source');await startClose();await pointer('[data-choice="save"]');await waitFor('closeResult?.ok === true && !fileBusy');
  assert.equal(fs.readFileSync(fixture,'utf8'),saved);
  // Untitled explicit close still prompts, and a canceled Save As preserves it.
  await run('window.mdview.newDocument()');await waitFor("currentDocument?.path==='' && !restoringView");
  await run("richEditor.editor.commands.insertContent('RECOVER ME');changed()");await delay(40);
  const originalSave=dialog.showSaveDialog;dialog.showSaveDialog=async()=>({canceled:true});
  await startClose();await pointer('[data-choice="save"]');await waitFor('closeResult !== null && !fileBusy');dialog.showSaveDialog=originalSave;
  assert.equal(await run('closeResult.canceled'),true);assert.equal(await run('tabs.find(t=>t.active).dirty'),true);
  // Untitled-only dirty exit never prompts and commits recovery.
  const beforeExit=lastQuestion;
  app.once('window-all-closed',()=> {
    try { assert.equal(lastQuestion,beforeExit);const data=JSON.parse(fs.readFileSync(path.join(dir,'profile','session.json'),'utf8'));assert.ok(data.tabs.some(t=>!t.path&&t.source.includes('RECOVER ME')));console.log('UNSAVED CONFIRM PASS: pointer save/discard/cancel/X, Escape, Tab trap, trusted IDs, three themes/narrow Unicode, failed save, canceled Save As, durable untitled exit'); }
    catch(error){console.error(error);process.exitCode=1;}
  });
  win.close();
})().catch(error=>{console.error(error);app.exit(1);});
