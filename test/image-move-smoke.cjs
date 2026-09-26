const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { renderMarkdown, readDocument } = require('../src/markdown.cjs');
const { saveTextFile } = require('../src/document-file.cjs');

// Pointer input starts a native drag; CDP delivers its intercepted, unmodified
// payload to Chromium. No fabricated HTML or synthetic DOM dragstart.

module.exports = async ({ win, outputDirectory }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => new Promise(r => setTimeout(r, 100));
  const visible = win.isVisible();
  win.show(); win.focus();
  const png = (await win.webContents.capturePage()).resize({width:240,height:120}).toPNG();
  await fs.writeFile(path.join(outputDirectory,'空 格 (a).png'),png);
  const source = 'left ![first\\]x](<空 格 (a).png> "title & (quoted)"){width=120} middle ![second](<空 格 (a).png>){width=100} right\n\ntarget paragraph';
  const doc = {source,...await renderMarkdown(source,outputDirectory)};
  const debug = win.webContents.debugger;
  let intercepted;
  const onMessage = (_event, method, params) => { if (method === 'Input.dragIntercepted') intercepted = params.data; };
  try {
    await run(`{const host=document.createElement('div');host.id='image-move-host';host.className='markdown';Object.assign(host.style,{position:'fixed',left:'24px',top:'70px',width:'600px',zIndex:1000,background:'white'});document.body.append(host);window.moveHarness=MdViewRich.create(host,${JSON.stringify(doc)},()=>{});window.moveEvents=[];for(const type of ['dragstart','drop','dragend']) host.addEventListener(type,e=>moveEvents.push({type,trusted:e.isTrusted,prevented:e.defaultPrevented}));} void 0`);
    await settle();
    debug.attach('1.3'); debug.on('message',onMessage);
    await debug.sendCommand('Input.setInterceptDrags',{enabled:true});
    const pointAt = pos => run(`(()=>{const e=moveHarness.editor;const r=e.view.coordsAtPos(${pos});return {x:Math.round(r.left),y:Math.round((r.top+r.bottom)/2)}})()`);
    const json = () => run('moveHarness.editor.getJSON()');
    await run("window.moveErrors=[];window.moveError=e=>moveErrors.push(e.error?.stack || e.message);window.addEventListener('error',moveError);window.moveViolations=[];window.moveCsp=e=>moveViolations.push(e.violatedDirective);document.addEventListener('securitypolicyviolation',moveCsp);if(document.querySelector('#toast')) document.querySelector('#toast').hidden=true");
    const originalURL = win.webContents.getURL();
    const original = await json();
    const gesture = async (index,end,{modifiers=0,cancel=false,beforeDrop}={}) => {
    intercepted = null;
    win.focus();
    await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,x:10,y:10});
    await new Promise(resolve=>setTimeout(resolve,250));
    const start = await run(`(()=>{const r=moveHarness.editor.view.dom.querySelectorAll('.editor-image img')[${index}].getBoundingClientRect();return {x:Math.round(r.x+r.width*.6),y:Math.round(r.y+r.height*.7)}})()`);
    await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...start});
    await debug.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...start});
    await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:start.x+160,y:start.y+90});
    await settle();
    await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...end});
    await settle();
    assert.ok(intercepted,`real Chromium image-body pointer gesture starts native drag: ${JSON.stringify({start,end,events:await run('moveEvents')})}`);
    assert.ok(await run("moveEvents.some(e=>e.type==='dragstart' && e.trusted && !e.prevented)"),'trusted dragstart');
    if(beforeDrop) await beforeDrop();
    if(cancel) await debug.sendCommand('Input.dispatchDragEvent',{type:'dragCancel',...end,data:intercepted});
    else for(const type of ['dragEnter','dragOver','drop']) await debug.sendCommand('Input.dispatchDragEvent',{type,...end,data:intercepted,modifiers});
    // Intercepted drops do not end the OS drag session themselves. Send its
    // native cancellation/end notification before the next gesture or remount.
    if(!cancel) await debug.sendCommand('Input.dispatchDragEvent',{type:'dragCancel',...end,data:intercepted});
    await debug.sendCommand('Input.cancelDragging');
    await debug.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...end});
    await settle();
    };
    await run('moveHarness.editor.commands.selectAll()');
    await gesture(0,await pointAt('e.state.doc.content.size-1'));
    const moved = await json();
    assert.equal(moved.content[1].content.at(-1).attrs.alt,'first]x','image moves across paragraphs');
    assert.equal(moved.content[0].content.filter(n=>n.type==='image').length,1,'source removed, not copied');
    await run('moveHarness.editor.commands.undo()'); assert.deepEqual(await json(),original);
    await run('moveHarness.editor.commands.redo()'); assert.deepEqual(await json(),moved);
    await gesture(1,await pointAt(1),{modifiers:2});
    assert.equal(await run("moveHarness.editor.view.dom.querySelectorAll('.editor-image').length"),2,'Ctrl body drag moves rather than copies');
    await run('moveHarness.editor.commands.undo()'); assert.deepEqual(await json(),moved,'independent undo per move');
    await run('moveHarness.editor.commands.undo()'); assert.deepEqual(await json(),original);
    const secondEnd = await run("(()=>{let p;moveHarness.editor.state.doc.descendants((n,pos)=>{if(n.attrs.alt==='second')p=pos+1});return p})()");
    await gesture(0,await pointAt(secondEnd));
    assert.deepEqual(await run("[...moveHarness.editor.view.dom.querySelectorAll('.editor-image img')].map(i=>i.alt)"),['second','first]x'],'inline reorder');
    assert.equal((await json()).content.length,2);
    await run('moveHarness.editor.commands.undo()'); assert.deepEqual(await json(),original);
    await run("moveHarness.editor.commands.insertContentAt(1,'typed ')");
    const typed = await json();
    await gesture(0,await pointAt('e.state.doc.content.size-1'));
    const typedMoved = await json();
    await run("moveHarness.editor.commands.insertContentAt(moveHarness.editor.state.doc.content.size-1,' after')");
    await run('moveHarness.editor.commands.undo()'); assert.deepEqual(await json(),typedMoved,'undo typing leaves move');
    await run('moveHarness.editor.commands.undo()'); assert.deepEqual(await json(),typed,'undo move leaves preceding typing');
    await run('moveHarness.editor.commands.undo()'); assert.deepEqual(await json(),original);
    await run("{const target=document.createElement('textarea');target.id='image-move-outside';target.value='outside unchanged';Object.assign(target.style,{position:'fixed',left:'680px',top:'400px',width:'100px',height:'70px',zIndex:1001});document.body.append(target)}");
    for(const options of [{cancel:true},{}]) {
      await gesture(0,{x:720,y:430},options);
      assert.deepEqual(await json(),original,options.cancel ? 'native cancel no mutation' : 'outside drop no mutation');
      assert.equal(await run('moveHarness.editor.commands.undo()'),false,'cancel/outside no history');
    }
    await run('moveHarness.editor.commands.setTextSelection(1)');
    const samePoint = await pointAt(6);
    await gesture(0,samePoint);
    assert.deepEqual(await json(),original,'drop on original position is a no-op');
    assert.equal(await run('moveHarness.editor.commands.undo()'),false,'self-drop creates no history');
    assert.equal(await run("document.querySelector('#image-move-outside').value"),'outside unchanged','outside editable never receives image data');
    assert.equal(win.webContents.getURL(),originalURL,'outside drop never navigates');
    assert.equal(await run("document.querySelector('#toast')?.hidden ?? true"),true,'internal move is not a file-drop error');
    await gesture(0,await pointAt('e.state.doc.content.size-1'),{beforeDrop:()=>run('moveHarness.editor.setEditable(false, false)')});
    assert.deepEqual(await json(),original,'read-only transition cancels active move');
    await run('moveHarness.editor.setEditable(true)');
    await gesture(0,await pointAt('e.state.doc.content.size-1'),{beforeDrop:()=>run('moveHarness.editor.commands.setTextSelection(1)')});
    assert.deepEqual(await json(),original,'selection change cancels rather than deleting unrelated text');
    assert.equal(await run('moveHarness.editor.commands.undo()'),false,'rejected moves add no history');
    assert.equal(await run('moveHarness.editor.getText()'),'left  middle  right\n\ntarget paragraph','surrounding text preserved');
    await gesture(0,await pointAt('e.state.doc.content.size-1'));
    assert.deepEqual(await json(),moved);
    for(let pass=0;pass<2;pass++) {
      const file=path.join(outputDirectory,`image-move-${pass}.md`);
      await saveTextFile(file,await run('moveHarness.source()'),{expectedHash:null});
      const reopened=await readDocument(file);
      assert.equal(await fs.readFile(file,'utf8'),reopened.source);
      assert.deepEqual(await run('moveViolations'),[],'native image drag adds no CSP violations');
      await run(`document.removeEventListener('securitypolicyviolation',moveCsp);moveHarness.destroy();window.moveHarness=MdViewRich.create(document.querySelector('#image-move-host'),${JSON.stringify(reopened)},()=>{});void 0`);
      await settle();
      await run("document.addEventListener('securitypolicyviolation',moveCsp)");
      const reopenedJSON = await json();
      const imageAttrs = value => value.content.flatMap(p=>p.content || []).filter(n=>n.type==='image').map(n=>n.attrs);
      assert.deepEqual(imageAttrs(reopenedJSON),imageAttrs(moved),'escaped src/alt/title and width survive disk save/reopen');
      assert.equal(await run('moveHarness.editor.getText().replace(/ +/g," ")'),'left middle right\n\ntarget paragraph','surrounding Markdown text survives HTML whitespace normalization');
      if(pass===0) { await gesture(1,await pointAt(1)); await run('moveHarness.editor.commands.undo()'); }
    }
    assert.deepEqual(await run('moveViolations'),[],'native image drag adds no CSP violations');
    const fileDrop = path.join(outputDirectory,'image-move-os-drop.md');
    await fs.writeFile(fileDrop,'# OS file drop still opens\n');
    const beforeFileDrop = await json();
    const filePoint = await pointAt('e.state.doc.content.size-1');
    for(const type of ['dragEnter','dragOver','drop']) await debug.sendCommand('Input.dispatchDragEvent',{type,...filePoint,data:{items:[],files:[fileDrop],dragOperationsMask:1}});
    await settle();
    assert.deepEqual(await json(),beforeFileDrop,'OS files never insert or overwrite editor content');
    if(await run("!!document.querySelector('#file-name')")) {
      for(let wait=0;wait<30 && await run("document.querySelector('#file-name').textContent")!=='image-move-os-drop.md';wait++) await settle();
      assert.equal(await run("document.querySelector('#file-name').textContent"),'image-move-os-drop.md','production OS file-drop opener remains active');
    }
    assert.deepEqual(await run('moveErrors'),[],'native drag has no renderer exceptions');
    console.log('Image move smoke: trusted pointer drag, cross-paragraph/inline reorder, Ctrl move not copy, exact text/attrs, separate undo+redo, cancel/outside/self/read-only/selection guards, escaped disk reopen twice, OS file drop, CSP passed');
  } finally {
    if(debug.isAttached()) { debug.off('message',onMessage); debug.detach(); }
    await run("window.removeEventListener('error',window.moveError);document.removeEventListener('securitypolicyviolation',window.moveCsp);window.moveHarness?.destroy();document.querySelector('#image-move-host')?.remove();document.querySelector('#image-move-outside')?.remove()");
    if(!visible) win.hide();
  }
};
