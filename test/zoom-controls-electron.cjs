const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, Menu, dialog } = require('electron');
const dir = process.env.MDVIEW_ZOOM_PROFILE_ROOT || fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-zoom-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => { win.setOpacity(0); win.setSkipTaskbar(true); win.webContents.setBackgroundThrottling(false); });
(async () => {
  const { win } = await require('../src/main.cjs');
  const run = code => win.webContents.executeJavaScript(code, true);
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async code => { for(let i=0;i<200;i++) { if(await run(code)) return; await delay(30); } assert.fail(code); };
  await wait('!!currentDocument && !restoringView && document.querySelector("#zoom-settings")?.dataset.ready === "true"');
  assert.equal(win.webContents.getZoomMode(), 'isolated');
  if (process.argv.includes('--verify-restored')) {
    assert.ok(Math.abs(win.webContents.getZoomFactor() - 1.1) < 0.001);
    assert.equal(await run('getComputedStyle(document.querySelector("#opened-files-search")).fontSize'), '13px');
    console.log('Fresh process restored UI zoom and sidebar font independently');
    win.destroy(); app.exit(0); return;
  }
  win.show(); win.focus(); win.webContents.debugger.attach('1.3');
  const wheel = async (selector, deltaY, modifiers=2) => {
    const point = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+Math.min(15,r.height/2)}})()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY,modifiers}); await delay(180);
  };
  const size = () => run('getComputedStyle(document.querySelector("#opened-files-search")).fontSize');
  const source = await run('payload().source');
  const originalFont = await run('fontSize');
  const width = await run('document.querySelector("#sidebar").getBoundingClientRect().width');
  await wheel('#outline a',-120);
  assert.equal(await size(),'13px'); assert.equal(await run('fontSize'),originalFont); assert.equal(win.webContents.getZoomFactor(),1);
  await run('document.querySelector("#sidebar-tab-files").click()');
  await wheel('.sidebar-file',-120);
  assert.equal(await size(),'14px');
  assert.equal(await run('getComputedStyle(document.querySelector(".sidebar-file .tab-name")).fontSize'),'14px');
  assert.equal(await run('document.querySelector("#sidebar").getBoundingClientRect().width'),width);
  await wheel('#opened-files-search',120,0); assert.equal(await size(),'14px');
  const viewport = await run('innerWidth');
  // The row center is its blank flex space, not a menu or quick-action button.
  await wheel('#menu-bar',-120);
  await wait('window.mdview.getSettings().then(s=>s.uiZoom===1.1)');
  assert.ok(Math.abs(win.webContents.getZoomFactor()-1.1)<0.001);
  assert.ok(await run('innerWidth') < viewport);
  assert.equal(await size(),'14px'); assert.equal(await run('fontSize'),originalFont);
  const native = Menu.getApplicationMenu().items[0].submenu, popup = native.popup;
  let options;
  native.popup = value => { options=value; value.callback(); };
  try { await run('window.mdview.popupMenu(0,{x:40,y:30})'); assert.equal(options.x,44); assert.equal(options.y,33); }
  finally { native.popup=popup; }
  // Bound checks on the trusted IPC endpoint, including malformed requests.
  for(const value of [-1,0,2,'1',null]) assert.equal(await run(`window.mdview.setUIZoom(${JSON.stringify(value)}).then(()=>false,()=>true)`),true);
  await wheel('#menu-bar',-5000); await wait('window.mdview.getSettings().then(s=>s.uiZoom===1.5)');
  await wheel('#menu-bar',5000); await wait('window.mdview.getSettings().then(s=>s.uiZoom===0.75)');
  await wheel('#opened-files-search',-5000); assert.equal(await size(),'22px');
  await wheel('#opened-files-search',5000); assert.equal(await size(),'10px');
  await run('openSettings()');
  await run('document.querySelector("#ui-zoom-reset").click(); document.querySelector("#sidebar-font-reset").click()');
  await wait('window.mdview.getSettings().then(s=>s.uiZoom===1)'); assert.equal(await size(),'12px');
  await run('document.querySelector("#settings-dialog").close(); toggleEditing()'); await wait('editing');
  await wheel('#editor-content .ProseMirror',-120); assert.equal(await run('fontSize'),originalFont+1); assert.equal(win.webContents.getZoomFactor(),1);
  await run('openCodeDialog(document.querySelector("#editor-content .expand-code"))');
  await wheel('#code-dialog-content pre',-120);
  assert.equal(await run('codeDialog.querySelector(".code-block").dataset.codeZoom'),'110');
  assert.equal(await run('fontSize'),originalFont+1);
  await run('codeDialog.close()');
  assert.equal(await run('payload().source'),source);
  // Preferences survive renderer reload; actual main zoom and physical popup anchors stay consistent.
  await wheel('#menu-bar',-120); await wheel('#opened-files-search',-120);
  await wait('window.mdview.getSettings().then(s=>s.uiZoom===1.1)');
  const confirm=dialog.showMessageBoxSync; dialog.showMessageBoxSync=()=>0;
  try { const loaded = new Promise(resolve=>win.webContents.once('did-finish-load',resolve)); win.webContents.reload(); await loaded; }
  finally { dialog.showMessageBoxSync=confirm; }
  await wait('document.querySelector("#zoom-settings")?.dataset.ready === "true"');
  assert.equal(await size(),'13px'); assert.ok(Math.abs(win.webContents.getZoomFactor()-1.1)<0.001);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'profile','settings.json'),'utf8')).uiZoom,1.1);
  win.setMinimumSize(320,300); win.setSize(540,640);
  const colors = new Set();
  for(const theme of ['light','dark','warm']) {
    await run(`document.querySelector('#theme').value='${theme}'; applyTheme(); openSettings()`);
    await delay(100);
    colors.add(await run('getComputedStyle(document.querySelector("#settings-dialog")).backgroundColor'));
    assert.ok(await run('document.querySelector("#ui-zoom-reset").getBoundingClientRect().right <= innerWidth'));
    await run('document.querySelector("#settings-dialog").close()');
  }
  assert.equal(colors.size,3);
  await run('window.mdview.setLanguage("en")'); await wait('document.querySelector("#zoom-settings legend").textContent === "Interface and sidebar zoom"');
  console.log('Zoom controls: native sidebar/files/menu/body/code wheels, bounds/reset, IPC validation, source isolation, persisted reload, actual webContents zoom, popup anchors, three themes/narrow and localization passed');
  win.destroy(); app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
