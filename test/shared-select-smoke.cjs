const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');
module.exports = async ({ win, openDocument }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),80))');
  const mouse = async selector => {
    const point = await run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await settle();
  };
  const key = async keyCode => {
    win.webContents.sendInputEvent({type:'keyDown',keyCode});
    win.webContents.sendInputEvent({type:'keyUp',keyCode}); await settle();
  };
  const fixture = path.join(app.getPath('userData'),'shared-select.md');
  fs.writeFileSync(fixture,'# Dropdowns\n\n```js\nconst a = 1;\nconst b = 2;\n```\n');
  await openDocument(fixture);
  await run('if(!editing)toggleEditing()'); await settle();
  await run("window.se=richEditor.editor;window.sp=0;se.state.doc.descendants((n,p)=>{if(n.type.name==='codeBlock')sp=p});se.commands.setTextSelection({from:sp+2,to:sp+8});se.view.focus();window.sc=0;document.querySelector('#editor-content select.code-language').addEventListener('change',()=>sc++)");
  const selection=await run('({from:se.state.selection.from,to:se.state.selection.to})');
  const codeTrigger='#editor-content .code-language-trigger';
  await mouse(codeTrigger);
  const menu=await run(`document.querySelector('${codeTrigger}').getAttribute('aria-controls')`);
  assert.equal(await run(`document.querySelector('#${menu}').matches(':popover-open')`),true);
  assert.equal(await run(`document.querySelector('#${menu}').scrollHeight>document.querySelector('#${menu}').clientHeight`),true,'long language list scrolls');
  await key('Home'); await key('p');
  assert.equal(await run(`document.getElementById(document.querySelector('${codeTrigger}').getAttribute('aria-activedescendant')).dataset.value`),'perl','typeahead finds first P language');
  await key('End');
  await mouse(`#${menu} [data-value="python"]`);
  assert.equal(await run('se.state.doc.nodeAt(sp).attrs.language'),'python');
  assert.deepEqual(await run('({from:se.state.selection.from,to:se.state.selection.to})'),selection);
  assert.equal(await run('sc'),1);
  await run('se.commands.undo()');await settle();
  assert.equal(await run(`document.querySelector('${codeTrigger}').textContent`),'js','undo synchronizes label');
  await run("document.querySelector('#editor-content select.code-language').value='python'");
  assert.equal(await run(`document.querySelector('${codeTrigger}').textContent`),'Python','direct value writes synchronize');
  await run("document.querySelector('#editor-content select.code-language').value='js';document.querySelector('#editor-content .expand-code').click()");
  assert.equal(await run('codeDialog.querySelectorAll("select,.code-language-trigger").length'),0,'clone contains static label only');
  assert.equal(await run('codeDialog.querySelector(".code-language").textContent'),'js');
  await run('codeDialog.close();openSettings()');await settle();
  const size=win.getSize();win.setSize(800,600);
  const palettes=[];
  for(const theme of ['light','dark','warm']) {
    await mouse('#theme-trigger');
    await mouse(`#theme-listbox [data-value="${theme}"]`);
    assert.equal(await run('document.documentElement.dataset.theme'),theme);
    await mouse('#theme-trigger');
    const geometry=await run(`(()=>{const m=document.querySelector('#theme-listbox'),r=m.getBoundingClientRect();return {inside:!!m.closest('#settings-dialog'),bounded:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:m.contains(document.elementFromPoint(r.x+10,r.y+10)),bg:getComputedStyle(m).backgroundColor}})()`);
    assert.equal(geometry.inside,true);assert.equal(geometry.bounded,true);assert.equal(geometry.hit,true,'modal popover is interactive');palettes.push(geometry.bg);
    await key('Escape');assert.equal(await run("document.querySelector('#settings-dialog').open"),true,'Escape dismisses menu first');
  }
  assert.equal(new Set(palettes).size,3);
  for(const locale of ['en','zh-CN','en']) {
    await mouse('#ui-language-trigger');await mouse(`#ui-language-listbox [data-value="${locale}"]`);
    assert.equal(await run('uiLanguage'),locale);
    assert.equal(await run("document.querySelector('#theme-trigger').textContent"),locale==='en'?'Warm paper':'暖纸');
  }
  await mouse('#ui-language-trigger');await key('Home');await key('Tab');
  assert.equal(await run("document.querySelector('#ui-language-listbox').matches(':popover-open')"),false);
  assert.equal(await run('uiLanguage'),'en','Tab cancels pending choice');
  await mouse('#theme-trigger');await key('Home');await key('Down');await key('Return');
  assert.equal(await run("document.querySelector('#theme').value"),'light','keyboard commits');
  await run("document.querySelector('#settings-dialog').close()");
  for (const locale of ['zh-CN', 'en']) {
    await run(`changeLanguage(${JSON.stringify(locale)})`);await settle();
    for (const theme of ['light', 'dark', 'warm']) {
      await run(`document.querySelector('#theme').value=${JSON.stringify(theme)};applyTheme()`);
      await mouse(codeTrigger);
      assert.equal(await run(`(()=>{const m=document.getElementById(document.querySelector('${codeTrigger}').getAttribute('aria-controls')),r=m.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&m.scrollWidth<=m.clientWidth})()`),true,'narrow code list stays bounded in both locales and all palettes');
      assert.equal(await run(`document.querySelector('${codeTrigger}').getAttribute('aria-label')`),locale==='en'?'Code language':'代码语言');
      await key('Escape');
    }
  }
  await run('se.commands.setTextSelection(sp+4);se.view.focus()');
  const caret=await run('se.state.selection.from');
  await mouse(codeTrigger);await mouse(`#${menu} [data-value="python"]`);
  assert.equal(await run('se.state.selection.from'),caret,'native pointer preserves caret');
  assert.equal(await run('se.state.selection.empty'),true);
  await run('se.commands.undo()');await settle();
  assert.equal(await run(`document.querySelector('${codeTrigger}').textContent`),'js');
  await mouse(codeTrigger);
  await run("se.commands.setContent('');document.querySelector('#theme').value='light';applyTheme()");await settle();
  assert.equal(await run(`!!document.getElementById('${menu}')`),false,'destroyed NodeView removes detached menu and listeners');
  const original=dialog.showMessageBoxSync;dialog.showMessageBoxSync=()=>1;
  try { const loaded=new Promise(r=>win.webContents.once('did-finish-load',r));win.webContents.reload();await loaded;await settle(); }
  finally { dialog.showMessageBoxSync=original;win.setSize(...size); }
  assert.equal(await run('uiLanguage'),'en','UI language survives fresh settings load');
  assert.equal(await run("document.querySelector('#theme').value"),'light','theme survives renderer reload');
  assert.equal(await run("document.querySelector('#theme-trigger').textContent"),'Light');
  console.log('PASS shared selects: native pointer, long-list scrolling, selection/undo/value sync, clones, keyboard, modal bounds, palettes, bilingual labels and reload persistence');
};
if(process.versions.electron&&process.argv.some(arg=>path.resolve(arg)===__filename)) {
  app.setPath('userData',fs.mkdtempSync(path.join(process.env.TMPDIR||app.getPath('temp'),'mdview-shared-select-')));app.disableHardwareAcceleration();
  const timer=setTimeout(()=>{console.error('shared selects timeout');app.exit(1)},90000);
  require('../src/main.cjs').then(async context=>{try{await module.exports(context);clearTimeout(timer);app.exit(0)}catch(e){console.error(e);app.exit(1)}});
}
