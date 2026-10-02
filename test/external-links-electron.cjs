const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {app,shell,clipboard}=require('electron');
const dir=fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'),'mdview-links-'));
app.setPath('userData',path.join(dir,'profile'));app.disableHardwareAcceleration();
const calls=[],original=shell.openExternal;shell.openExternal=async href=>{calls.push(href);};
app.on('browser-window-created',(_e,w)=>{w.setOpacity(0);w.setFocusable(false);w.setIgnoreMouseEvents(true);w.setSkipTaskbar(true);w.webContents.setBackgroundThrottling(false);w.showInactive();});
(async()=>{
 const {win,editSession}=await require('../src/main.cjs');
 win.webContents.setBackgroundThrottling(false);
 win.setFocusable(true);win.focus();
 const run=code=>win.webContents.executeJavaScript(code,true);
 const delay=()=>new Promise(r=>setTimeout(r,60));
 const wait=async code=>{for(let i=0;i<200;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,20));}assert.fail(code);};
 await wait('!!currentDocument && !restoringView');
 const target='https://example.invalid/path?q=%2f&next=%23#Part';
 const file=path.join(dir,'links.md');fs.writeFileSync(file,`# Synthetic\n\n[Link selection text](${target}) ordinary text\n\n| Field | Value |\n| --- | --- |\n| [Table target](${target}) | resize |\n`);
 editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));await wait('currentDocument?.name==="links.md" && !restoringView');
 const originalURL=win.webContents.getURL();let navigations=0;win.webContents.on('will-navigate',()=>navigations++);
 const click=async (selector,options={})=>{
   const point=await run(`(async()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el.closest('[role="menu"]'))el.scrollIntoView({block:'center',behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=el.getBoundingClientRect();return{x:Math.round(r.left+Math.min(25,r.width/2)),y:Math.round(r.top+r.height/2)};})()`);
   win.webContents.sendInputEvent({type:'mouseMove',...point});
   win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point,...options});
   win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point,...options});await delay();
 };
 for(const edit of [false,true]){
   if(await run('editing')!==edit)await run('toggleEditing()');await wait(`editing===${edit} && !restoringView`);
   const selector=edit?'#editor-content a':'#content a';
   const before=calls.length,sourceBefore=await run('payload().source');
   await click(selector);
   assert.deepEqual(calls.slice(before),edit?[]:[target],`${edit?'edit ordinary click only places caret':'read click opens exact target'}`);
   if(edit)await click(selector,{modifiers:['control']});
   assert.deepEqual(calls.slice(before),[target],'mode-appropriate activation reaches shell with exact target');
   assert.equal(await run('payload().source'),sourceBefore,'link activation never edits content');
   await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);
   assert.equal(await run(`document.activeElement === document.querySelector(${JSON.stringify(selector)})`),true,'link is keyboard focusable');
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter',modifiers:edit?['control']:[]});
   win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter',modifiers:edit?['control']:[]});await delay();
   assert.deepEqual(calls.slice(before),[target,target],'keyboard activation opens exact URL');
   const selectionBefore=await run('editing ? richEditor.editor.state.selection.toJSON() : null');
   await click(selector,{button:'right'});await wait('!!document.querySelector("[data-open-external-link]")');
   await click('[data-open-external-link]');assert.deepEqual(calls.slice(before),[target,target,target],'context open uses same exact target bridge');
   assert.equal(await run('!!document.querySelector(".plaintext-copy-menu")'),false,'open link closes its shared selection menu');
   if(edit)assert.deepEqual(await run('richEditor.editor.state.selection.toJSON()'),selectionBefore,'context open preserves editor selection');
   assert.equal(await run('payload().source'),sourceBefore,'keyboard/context open never changes source');
   const count=calls.length;
   await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay();assert.equal(calls.length,count,'synthetic click cannot open external');
   // Collapse the prior Ctrl/Shift test selection before beginning a fresh drag.
   await click(edit?'#editor-content h1':'#content h1');
   // Native pointer drag selects actual link text; no external launch and Ctrl+C works.
   const points=await run(`(()=>{const a=document.querySelector(${JSON.stringify(selector)});a.scrollIntoView({block:'center',behavior:'instant'});const r=a.getBoundingClientRect();return{start:{x:Math.round(r.right+60),y:Math.round(r.top+r.height/2)},end:{x:Math.round(r.left+2),y:Math.round(r.top+r.height/2)}};})()`);
   win.webContents.sendInputEvent({type:'mouseMove',...points.start});win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...points.start});await delay();
   for(let step=1;step<=8;step++) {win.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],x:Math.round(points.start.x+(points.end.x-points.start.x)*step/8),y:points.end.y});await new Promise(r=>setTimeout(r,15));}
   win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...points.end});await delay();
   assert.equal(calls.length,count,'drag selection never launches');
   // This Windows Electron build collapses injected drags in even a bare
   // contenteditable fixture. Verify editor text selection with native keys;
   // the drag above still independently proves it cannot launch a browser.
   if(edit){
     win.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});
     win.webContents.sendInputEvent({type:'keyDown',keyCode:'End',modifiers:['shift']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});await delay();
   }
   const selected=await run('window.getSelection().toString()');assert.ok(selected.length>5,edit?'native keyboard selects link text':'native drag selects link text');
   await clipboard.clear();win.webContents.sendInputEvent({type:'keyDown',keyCode:'c',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'c',modifiers:['control']});await delay();
   assert.equal(await clipboard.readText(),selected,'native Ctrl+C remains intact');
   for(const modifiers of (edit?[['shift'],['alt'],['meta'],['control','shift']]:[['control'],['shift'],['alt'],['meta']])){await click(selector,{modifiers});assert.equal(calls.length,count,'modifier does not launch');}
   await click(selector,{button:'right'});assert.equal(calls.length,count,'right-click does not launch');
   await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.getSelection().removeAllRanges()`);
   await click(selector,{button:'middle'});assert.equal(calls.length,count,'middle click cannot navigate');
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay();
   for(const href of ['app://view','custom:command','https://name:password@example.invalid/','https://@example.invalid/','https:///example.invalid/path','http:////example.invalid/path','javascript:alert(1)','data:text/html,bad','file:///C:/secret','//example.invalid','https:\\example.invalid','mailto:test@example.invalid','https://example.invalid\n']){
     await run(`document.querySelector(${JSON.stringify(selector)}).setAttribute('href',${JSON.stringify(href)})`);
     const unsafeSource=await run('payload().source');
     await click(selector,edit?{modifiers:['control']}:{});assert.equal(calls.length,count,'renderer rejects '+href);
     assert.equal(await run('payload().source'),unsafeSource,'blocked activation does not mutate source');
     await run(`window.mdview.external(${JSON.stringify(href)})`);assert.equal(calls.length,count,'main revalidates '+href);
   }
   await run(`document.querySelector(${JSON.stringify(selector)}).setAttribute('href',${JSON.stringify(target)})`);
   await click(edit?'#editor-content h1':'#content h1');assert.equal(calls.length,count,'nonlink does not launch');
   assert.equal(win.webContents.getURL(),originalURL);assert.equal(navigations,0);
   const tableSelector=edit?'#editor-content table a':'#content table a';
   const tableSource=await run('payload().source'),tableBefore=calls.length;
   await click(tableSelector,edit?{modifiers:['control']}:{});
   assert.deepEqual(calls.slice(tableBefore),[target],'link inside table opens unchanged target');
   await click(tableSelector,{button:'right'});await wait('!!document.querySelector("[data-open-external-link]")');
   if(edit)assert.equal(await run('!!document.querySelector(".table-context-menu [data-table-action=mergeBelow]")'),true,'link action extends structural table menu');
   await click('[data-open-external-link]');assert.deepEqual(calls.slice(tableBefore),[target,target]);
   assert.equal(await run('payload().source'),tableSource,'table link actions leave source unchanged');
 }
 // Resizing table widths must never be mistaken for a link gesture.
 const count=calls.length;
 await click('#editor-content [data-resize-table]');assert.equal(calls.length,count);
 assert.equal(await run('richEditor.editor.getJSON().content[1].content[0].marks.some(m=>m.type==="link")'),true,'link mark remains editable');
 const pasteBefore=await run('payload().source');
 await run('richEditor.editor.commands.setTextSelection(richEditor.editor.state.doc.content.size-1);richEditor.editor.view.focus();void 0');
 await clipboard.writeText('https://example.invalid/pasted-only');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'v',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'v'});await delay();
 assert.equal(calls.length,count,'native URL paste never opens browser');assert.match(await run('payload().source'),/pasted-only/);
 await run('richEditor.editor.commands.undo()');assert.equal(await run('payload().source'),pasteBefore,'URL paste remains ordinary undoable editing');
 console.log('EXTERNAL LINKS PASS: read click/edit Ctrl+click, focused-link keyboard/context activation, table/copy menus, exact trusted IPC/shell target, credentials/schemes blocked, Ctrl+C/source unchanged, no navigation');
 shell.openExternal=original;win.destroy();app.exit(0);
})().catch(error=>{shell.openExternal=original;console.error(error);app.exit(1);});
