// Standalone: node_modules/.bin/electron test/image-group-smoke.cjs
// --integrated verifies the production factory wiring without explicit install.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function checks({ win, scratch }) {
  const run = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch(error) { console.error('Failed renderer expression:',code); throw error; } };
  const wait = () => new Promise(resolve => setTimeout(resolve, 90));
  const mouse = async (selector, button = 'left', modifiers = []) => {
    const p = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width*.6),y:Math.round(r.y+r.height*.7)}})()`);
    win.webContents.sendInputEvent({type:'mouseMove',...p});
    for (const type of ['mouseDown','mouseUp']) win.webContents.sendInputEvent({type,...p,button,modifiers,clickCount:1});
    await wait();
  };
  const img = index => `.editor-image:nth-of-type(${index+1}) > img`;
  const initial=await run('e.getJSON()');
  const p=await run('(()=>{const r=e.view.dom.querySelector(".editor-image img").getBoundingClientRect();return {x:Math.round(r.x+r.width*.6),y:Math.round(r.y+r.height*.7)}})()');
  win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1,modifiers:['control']});
  win.webContents.sendInputEvent({type:'mouseMove',x:p.x+80,y:p.y+40,modifiers:['control','leftButtonDown']});
  win.webContents.sendInputEvent({type:'mouseUp',x:p.x+80,y:p.y+40,button:'left',clickCount:1,modifiers:['control']});await wait();
  assert.deepEqual(await run('e.getJSON()'),initial,'modifier pointer movement neither drags nor resizes');
  assert.deepEqual(await run('imageEvents'),[],'modifier gesture suppresses native dragstart');
  await mouse(img(0),'left',['control']); // toggle off the gesture selection
  await mouse(img(0),'left',['control']);
  await mouse(img(1),'left',['control']);
  assert.equal(await run('document.querySelectorAll(".image-group-selected").length'),2,'native Ctrl-click selects two images');
  assert.equal(await run('getComputedStyle(document.querySelector(".image-group-selected")).outlineStyle'), 'solid');
  await mouse(img(1),'right');
  assert.equal(await run('!!document.querySelector(".image-group-menu")'),true,'native right-click opens batch controls');
  const attrs=()=>run('(()=>{const result=[];e.state.doc.descendants(n=>{if(n.type.name==="image")result.push(n.attrs)});return result})()');
  const original=await attrs();
  const originalText=await run('e.getText()');
  await run('window.groupCsp=[];window.onGroupCsp=event=>groupCsp.push(event.violatedDirective);document.addEventListener("securitypolicyviolation",onGroupCsp)');
  await mouse('[data-image-group-action="equalHeight"]');
  assert.deepEqual((await attrs()).map(a=>a.width),[160,40,100],'equal heights derives widths independently from natural ratios');
  const heights=await run('[...e.view.dom.querySelectorAll(".editor-image img")].map(i=>i.getBoundingClientRect().height)');
  assert.ok(Math.abs(heights[0]-heights[1])<1,JSON.stringify(heights));
  const equal=await attrs();
  await run('e.commands.undo()'); assert.deepEqual(await attrs(),original,'one undo restores entire group');
  await run('e.commands.redo()'); assert.deepEqual(await attrs(),equal,'one redo restores group');
  await mouse(img(1),'right');
  assert.equal(await run('!!document.querySelector(".image-group-menu")'),true,'right-click still opens after undo/redo');
  await run('document.querySelector("[data-image-group-dimension=width]").value="120"');
  await mouse('[data-image-group-action="width"]');
  assert.deepEqual((await attrs()).map(a=>a.width),[120,120,100]);
  assert.deepEqual(await run('[...e.view.dom.querySelectorAll(".editor-image img")].map(i=>Math.round(i.getBoundingClientRect().height))'),[60,240,100]);
  await mouse(img(1),'right');
  await run('document.querySelector("[data-image-group-dimension=height]").value="96"');
  await mouse('[data-image-group-action="height"]');
  assert.deepEqual((await attrs()).map(a=>a.width),[192,48,100]);
  const final=await attrs();
  for(let i=0;i<3;i++) assert.deepEqual({...final[i],width:original[i].width},original[i],'source/alt/title untouched');
  await run('e.commands.undo()');assert.deepEqual((await attrs()).map(a=>a.width),[120,120,100],'batch actions have independent undo boundaries');
  await run('e.commands.redo()');
  await run('e.commands.insertContentAt(1,"typed after ")');
  await run('e.commands.undo()');
  assert.deepEqual(await attrs(),final,'undo subsequent typing leaves batch dimensions intact');
  const file=path.join(scratch,'group-saved.md');
  await require('../src/document-file.cjs').saveTextFile(file,await run('fixture.source()'),{expectedHash:null});
  const restored=await require('../src/markdown.cjs').readDocument(file);
  assert.equal(await run('e.getText()'),originalText,'batch actions never change surrounding text');
  assert.deepEqual(await run('groupCsp'),[],'batch UI adds no CSP violations');
  await run('document.removeEventListener("securitypolicyviolation",onGroupCsp)');
  await run(`fixture.destroy();make(${JSON.stringify(restored)})`);await wait();
  assert.deepEqual(await attrs(),final,'disk save/reopen persists width-only dimensions');
  assert.equal(restored.source.includes('<img'),false,'no HTML persistence');
  assert.deepEqual(await run('imageEvents'),[],'selection never starts image drag');
  // Native range/toggle selection, position mapping, deletion and read-only cleanup.
  await mouse(img(0),'left',['control']);
  await mouse(img(2),'left',['shift']);
  assert.equal(await run('document.querySelectorAll(".image-group-selected").length'),3,'Shift range spans all images');
  await mouse(img(1),'left',['control']);
  assert.equal(await run('document.querySelectorAll(".image-group-selected").length'),2,'Ctrl toggles off');
  await run('e.commands.insertContentAt(1,"prefix ")');
  assert.deepEqual(await run('[...document.querySelectorAll(".image-group-selected img")].map(i=>i.alt)'),['wide','square'],'selection maps through text insertion');
  await run('(()=>{let pos;e.state.doc.descendants((n,p)=>{if(n.attrs.alt==="wide")pos=p});e.view.dispatch(e.state.tr.delete(pos,pos+1))})()');
  assert.deepEqual(await run('[...document.querySelectorAll(".image-group-selected img")].map(i=>i.alt)'),['square'],'deletion clears only missing image');
  await run('e.setEditable(false,false)');await wait();
  assert.equal(await run('document.querySelectorAll(".image-group-selected").length'),0,'silent read-only clears markers');
  await run('e.setEditable(true)');
  await run(`fixture.destroy();make(${JSON.stringify(restored)})`);await wait();
  await mouse(img(0),'left',['control']);await mouse(img(1),'left',['control']);
  // Opening via the keyboard works immediately after pointer multi-selection.
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'F10',modifiers:['shift']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'F10',modifiers:['shift']});await wait();
  assert.equal(await run('!!document.querySelector(".image-group-menu")'),true,'Shift-F10 opens group controls');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait();
  assert.equal(await run('!!document.querySelector(".image-group-menu")'),false,'Escape dismisses');
  // Ctrl over an existing size button selects, rather than shrinking the image.
  await mouse('.editor-image .image-size-decrease','left',['control']);
  assert.equal(await run('document.querySelectorAll(".image-group-selected").length'),1,'modifier capture precedes NodeView controls');
  assert.deepEqual(await attrs(),final,'modifier size-button click does not resize');
  await mouse(img(1),'left',['control']);
  await run('(()=>{const tr=e.state.tr;e.state.doc.descendants((n,p)=>{if(n.attrs.alt==="wide")tr.setNodeMarkup(p,undefined,{...n.attrs,width:32})});e.view.dispatch(tr)})()');
  await mouse(img(1),'right');
  assert.equal(await run('document.querySelector("[data-image-group-action=equalHeight]").disabled'),true,'infeasible first-selected height is disabled, not independently clamped');
  assert.match(await run('document.querySelector(".image-group-status").textContent'),/outside this range/);
  const bounded=await attrs();
  await run('document.querySelector("[data-image-group-dimension=height]").value="1"');
  await mouse('[data-image-group-action="height"]');
  assert.deepEqual(await attrs(),bounded,'invalid height does not modify document');
  await run('document.documentElement.lang="zh-CN"');
  await mouse(img(1),'right');
  assert.match(await run('document.querySelector(".image-group-menu").textContent'),/共同高度/);
  assert.equal(await run('(()=>{const r=document.querySelector(".image-group-menu").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'),true,'menu stays in viewport');
  for(const theme of ['light','dark','warm']) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    assert.equal(await run('getComputedStyle(document.querySelector(".image-group-menu")).backgroundColor===getComputedStyle(document.querySelector(".image-size-controls")).backgroundColor'),true,theme+' uses existing surface tokens');
  }
  await run('document.querySelector("#editor").style.width="80px";document.documentElement.lang="en"');
  await mouse(img(1),'right');
  assert.equal(await run('document.querySelector("[data-image-group-action=height]").disabled'),true,'disjoint responsive width limits disable all height actions');
  assert.match(await run('document.querySelector(".image-group-status").textContent'),/no shared height range/);
  await run('document.querySelector("#editor").style.width=""');
  // A missing asset cannot provide the ratio needed for a height operation.
  await run('(()=>{const tr=e.state.tr;e.state.doc.descendants((n,p)=>{if(n.attrs.alt==="wide")tr.setNodeMarkup(p,undefined,{...n.attrs,src:"missing.png"})});e.view.dispatch(tr)})()');
  await mouse('.editor-image:nth-of-type(1)','left',['control']);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'F10',modifiers:['shift']});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'F10',modifiers:['shift']});await wait();
  assert.equal(await run('document.querySelector("[data-image-group-action=height]").disabled'),true,'unloaded images disable height conversion');
  await run('fixture.destroy()');
  assert.equal(await run('document.querySelectorAll(".image-group-menu").length'),0,'destroy removes menu');
}
module.exports = checks;
if(process.argv.some(arg => /image-group-smoke\.cjs$/.test(arg))) {
  const {app,BrowserWindow} = require('electron');
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'),'mdview-image-group-'));
  app.setPath('userData',path.join(scratch,'profile'));
  app.whenReady().then(async()=>{
    let win;
    try {
      const root=path.resolve(__dirname,'..');
      const exists=fs.existsSync(path.join(root,'src/image-group-controls.js'));
      const explicit=exists && !process.argv.includes('--integrated');
      require('esbuild').buildSync({stdin:{contents:`import {create} from './src/rich-editor.js'; ${explicit ? "import {installImageGroupControls} from './src/image-group-controls.js';" : ''} window.make=doc=>{window.fixture=create(document.querySelector('#editor'),doc,()=>{});window.e=fixture.editor; ${explicit ? 'window.group=installImageGroupControls(e);' : ''}};`,resolveDir:root},bundle:true,platform:'browser',outfile:path.join(scratch,'fixture.js')});
      const entry=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
      const csp=entry.match(/content="(default-src[^"]+)"/)[1];
      const sheets=process.argv.includes('--integrated') ? [...entry.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g)].map(match=>match[1]) : ['style.css',...(exists ? ['image-group-controls.css'] : [])];
      const css=sheets.map(name=>`<link rel="stylesheet" href="${pathToFileURL(path.join(root,'src',name)).href}">`).join('');
      fs.writeFileSync(path.join(scratch,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${css}<script src="fixture.js" defer></script></head><body><div class="markdown" id="editor"></div></body></html>`);
      win=new BrowserWindow({show:true,width:1000,height:850,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
      await win.loadFile(path.join(scratch,'index.html')); win.focus();
      const run=code=>win.webContents.executeJavaScript(code,true);
      const image=await win.webContents.capturePage();
      for(const [name,width,height] of [['wide',240,120],['tall',120,240],['square',160,160]]) fs.writeFileSync(path.join(scratch,`${name}.png`),image.resize({width,height}).toPNG());
      const source='left ![wide](wide.png "title"){width=160} middle ![tall](tall.png){width=50} ![square](square.png){width=100} right';
      const doc={source,...await require('../src/markdown.cjs').renderMarkdown(source,scratch)};
      await run(`make(${JSON.stringify(doc)});window.imageEvents=[];e.view.dom.addEventListener('dragstart',event=>imageEvents.push(event.type));`);
      await new Promise(resolve=>setTimeout(resolve,150));
      await checks({win,scratch});
      console.log('PASS image group controls');
    } catch(error) {console.error(error);process.exitCode=1;}
    finally {win?.destroy();app.exit(process.exitCode || 0);}
  });
}
