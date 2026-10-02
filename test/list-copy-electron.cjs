const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app,clipboard} = require('electron');
const dir=fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'),'mdview-list-copy-'));
app.setPath('userData',path.join(dir,'profile')); app.disableHardwareAcceleration();
app.on('browser-window-created',(_e,w)=>{w.webContents.on('console-message',(_e,...args)=>console.log('RENDERER',...args));w.setOpacity(0);w.setFocusable(false);w.setIgnoreMouseEvents(true);w.setSkipTaskbar(true);w.webContents.setBackgroundThrottling(false);w.showInactive();});
(async()=>{
 const {win,editSession}=await require('../src/main.cjs');
 // Disable throttling on the loaded renderer as well as the native window.
 win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code,true);
 const wait=async code=>{for(let i=0;i<150;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,20));}assert.fail(code);};
 await wait('!!currentDocument && !restoringView');
 const file=path.join(dir,'lists.md');
 fs.writeFileSync(file,'1. first\n2. middle\n3. last\n');
 editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));
 await wait('currentDocument?.name === "lists.md" && !restoringView');
 await run('toggleEditing()'); await wait('editing && !restoringView');
 for(const start of [1,0,5]) {
  await run(`richEditor.editor.commands.setContent('<ol start="${start}"><li><p>first</p></li><li><p>middle</p></li><li><p>last</p></li></ol>')`);
  await run(`(()=>{const e=richEditor.editor;let from,to;e.state.doc.descendants((n,p)=>{if(n.type.name==='listItem'&&n.textContent==='middle'){from=p;to=p+n.nodeSize;}});e.commands.deleteRange({from,to});})()`);
  const result=await run('({json:richEditor.editor.getJSON(),md:richEditor.editor.getMarkdown(),html:richEditor.editor.getHTML()})');
  assert.equal(result.md.trimEnd(),`${start}. first\n${start+1}. last`);
  // Native Backspace on a text range spanning one middle item and its break.
  await run(`richEditor.editor.commands.setContent('<ol start="${start}"><li><p>first</p></li><li><p>middle</p></li><li><p>last</p></li></ol>');(()=>{const e=richEditor.editor;let from,to;e.state.doc.descendants((n,p)=>{if(n.type.name==='paragraph'&&n.textContent==='middle')from=p+1;if(n.type.name==='paragraph'&&n.textContent==='last')to=p+1;});e.commands.setTextSelection({from,to});e.view.focus();})()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'});
  await wait(`richEditor.editor.getMarkdown().trimEnd() === ${JSON.stringify(`${start}. first\n${start+1}. last`)}`);
  assert.equal(await run('richEditor.editor.state.doc.firstChild.attrs.start'),start);
  // Backspace lifts a middle item, splitting one list into two fragments.
  await run(`richEditor.editor.commands.setContent('<ol start="${start}"><li><p>first</p></li><li><p>middle</p></li><li><p>last</p></li></ol>');(()=>{const e=richEditor.editor;let pos;e.state.doc.descendants((n,p)=>{if(n.type.name==='paragraph'&&n.textContent==='middle')pos=p+1;});e.commands.setTextSelection(pos);e.view.focus();})()`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'});
  await wait(`richEditor.editor.getMarkdown().trimEnd() === ${JSON.stringify(`${start}. first\n\nmiddle\n\n${start+1}. last`)}`);
  const readerFile=path.join(dir,`roundtrip-${start}.md`);fs.writeFileSync(readerFile,await run('richEditor.editor.getMarkdown()'));
  const reader=await require('../src/markdown.cjs').readDocument(readerFile);
  assert.match(reader.html,start===1?/<ol>/ :new RegExp(`<ol start="${start}">`));
 }
  // Selection is a real Chromium range; copy uses production trusted IPC.
 assert.equal(await run('typeof window.MdViewPlaintextCopy?.selectionText'), 'function', 'plaintext selection serializer installed');
 const mixed = '# 标题\n\n## 1. 手写标题\n\n5. 中文 first\n6. second\n\n   0. nested zero\n   1. nested one\n7. last 2026\n\n2026 年份 and 42 digits [链接](https://example.com)\n\n```txt\n  1. literal code\n   \n  2026  token\n```\n\n| A | B |\n| --- | --- |\n| 一 | 42 |\n';
 const mixedFile=path.join(dir,'mixed.md'); fs.writeFileSync(mixedFile,mixed); editSession.openDocument(await require('../src/markdown.cjs').readDocument(mixedFile));
 await wait('currentDocument?.source.includes("标题") && !restoringView');
 if(await run('editing')) {await run('toggleEditing()');await wait('!editing && !restoringView');}
 await run('document.getElementById("heading-numbering-enabled").checked=true;document.getElementById("heading-numbering-enabled").dispatchEvent(new Event("change"))');
 for (const editorMode of [false,true]) {
  if(editorMode) {await run('toggleEditing()');await wait('editing && !restoringView');}
  const root=editorMode?'#editor-content .tiptap':'#content';
  const result=await run(`(()=>{const root=document.querySelector(${JSON.stringify(root)});const r=document.createRange();r.selectNodeContents(root);window.getSelection().removeAllRanges();window.getSelection().addRange(r);return {plain:MdViewPlaintextCopy.selectionText(root,r,false),numbered:MdViewPlaintextCopy.selectionText(root,r,true)};})()`);
  assert.match(result.numbered,/一、标题/); assert.match(result.numbered,/5\. 中文 first\n6\. second\n  0\. nested zero\n  1\. nested one\n7\. last 2026/);
  assert.match(result.plain,/1\. 手写标题/);assert.match(result.plain,/2026 年份 and 42 digits 链接/);
  assert.match(result.plain,/  1\. literal code\n  2026  token/);assert.match(result.plain,/A\tB\n一\t42/);
  assert.ok(!result.plain.split('\n').some(line=>!line.trim()));
  const before=await run('({source:payload().source,json:editing?JSON.stringify(richEditor.editor.getJSON()):null,selection:editing?JSON.stringify(richEditor.editor.state.selection.toJSON()):null,undo:editing?richEditor.editor.can().undo():null})');
  const point=await run(`(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector(${JSON.stringify(root)}+' h1'));const r=range.getBoundingClientRect();return{x:Math.round((r.left+r.right)/2),y:Math.round((r.top+r.bottom)/2)};})()`);
  win.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});
  await wait('!!document.querySelector("[data-plaintext-copy=numbered]")');
  await run('document.querySelector("[data-plaintext-copy=numbered]").click()');
  await wait('!document.querySelector("[data-plaintext-copy=numbered]")');
  assert.equal((await clipboard.readText()).replace(/\r\n/g,'\n'),result.numbered);
  assert.equal(await clipboard.has('text/plain'),true); assert.equal(await clipboard.has('text/html'),false); assert.equal(await clipboard.has('text/rtf'),false);
  assert.deepEqual(await run('({source:payload().source,json:editing?JSON.stringify(richEditor.editor.getJSON()):null,selection:editing?JSON.stringify(richEditor.editor.state.selection.toJSON()):null,undo:editing?richEditor.editor.can().undo():null})'),before);
  // The other action copies the same snapshot without generated markers.
  win.webContents.sendInputEvent({type:'mouseDown',button:'right',clickCount:1,...point});win.webContents.sendInputEvent({type:'mouseUp',button:'right',clickCount:1,...point});
  await wait('!!document.querySelector("[data-plaintext-copy=plain]")');
  await run('document.querySelector("[data-plaintext-copy=plain]").click()');await wait('!document.querySelector("[data-plaintext-copy=plain]")');
  assert.equal((await clipboard.readText()).replace(/\r\n/g,'\n'),result.plain);
 }
 // Extending table context must retain its structural controls and text range.
 await run(`(()=>{const root=document.querySelector('#editor-content .tiptap'),cells=root.querySelectorAll('th,td'),r=document.createRange();r.setStart(cells[0].querySelector('p').firstChild,0);r.setEnd(cells[3].querySelector('p').firstChild,2);window.getSelection().removeAllRanges();window.getSelection().addRange(r);root.focus();})()`);
 await new Promise(r=>setTimeout(r,50));
 const tableBefore=await run('JSON.stringify(richEditor.editor.state.selection.toJSON())');
 await run(`document.querySelector('#editor-content th').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200,cancelable:true}))`);
 await wait('!!document.querySelector(".table-context-menu [data-plaintext-copy=plain]")');
 assert.equal(await run('!!document.querySelector(".table-context-menu [data-table-action=deleteRow]")'),true);
 assert.equal(await run('JSON.stringify(richEditor.editor.state.selection.toJSON())'),tableBefore,'opening extended table menu preserves text selection');
 await run('document.querySelector(".table-context-menu [data-plaintext-copy=plain]").click()');
 await wait('!document.querySelector(".table-context-menu")');
 assert.equal((await clipboard.readText()).replace(/\r\n/g,'\n'),'A\tB\n一\t42');
 // Visible table CellSelection is also a selection, even with collapsed DOM caret.
 await run(`(()=>{const e=richEditor.editor;const cells=[];e.state.doc.descendants((n,p)=>{if(n.type.name==='tableCell'||n.type.name==='tableHeader')cells.push(p);});e.commands.setCellSelection({anchorCell:cells[0],headCell:cells[3]});})()`);
 const cellBefore=await run('JSON.stringify(richEditor.editor.state.selection.toJSON())');
 await run(`document.querySelector('#editor-content th').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:200,cancelable:true}))`);
 await wait('!!document.querySelector(".table-context-menu [data-plaintext-copy=plain]")');
 await run('document.querySelector(".table-context-menu [data-plaintext-copy=plain]").click()');await wait('!document.querySelector(".table-context-menu")');
 assert.equal((await clipboard.readText()).replace(/\r\n/g,'\n'),'A\tB\n一\t42');
 assert.equal(await run('JSON.stringify(richEditor.editor.state.selection.toJSON())'),cellBefore);
 // Keyboard dismissal, both languages, narrow viewport and excluded controls.
 win.setMinimumSize(320,300);win.setContentSize(400,600);
 await run('window.copyCsp=[];document.addEventListener("securitypolicyviolation",e=>copyCsp.push(e.violatedDirective))');
 for(const lang of ['zh-CN','en']) {
  await run(`window.mdview.setLanguage(${JSON.stringify(lang)})`);
  // Replace the previous model CellSelection as a real heading selection would.
  await run('richEditor.editor.commands.setTextSelection({from:1,to:1+richEditor.editor.state.doc.firstChild.content.size});richEditor.editor.view.focus();void 0');
  await run(`(()=>{const h=document.querySelector('#editor-content h1'),r=document.createRange();r.selectNodeContents(h);window.getSelection().removeAllRanges();window.getSelection().addRange(r);h.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:399,clientY:599}));})()`);
  await wait('!!document.querySelector(".plaintext-copy-menu")');
  assert.deepEqual(await run('[...document.querySelectorAll(".plaintext-copy-menu button")].map(b=>b.textContent)'),lang==='en'?['Copy plain text (with numbering)','Copy plain text (without numbering)']:['无格式复制（带序号）','无格式复制（不带序号）']);
  assert.equal(await run('(()=>{const m=document.querySelector(".plaintext-copy-menu"),r=m.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&m.scrollWidth<=m.clientWidth;})()'),true);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'End'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'End'});
  await wait('document.activeElement.dataset.plaintextCopy === "plain"');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await wait('!document.querySelector(".plaintext-copy-menu")');
 }
 await run('document.querySelector("#document-search-query").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true}))');
 assert.equal(await run('!!document.querySelector(".plaintext-copy-menu")'),false);
 assert.deepEqual(await run('copyCsp'),[]);
 // Ordinary Ctrl+C remains the native rich editor operation (HTML included).
 await run(`(()=>{const e=richEditor.editor;let p;e.state.doc.descendants((n,at)=>{if(n.isText&&n.text==='标题')p=at;});e.commands.setTextSelection({from:p,to:p+2});e.view.focus();})()`);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'c',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'c',modifiers:['control']});
 for(let i=0;i<100;i++){if((await clipboard.readText()).trim()==='标题')break;await new Promise(r=>setTimeout(r,20));}
 assert.equal((await clipboard.readText()).trim(),'标题');assert.equal(await clipboard.has('text/html'),true);
 console.log('list-copy electron PASS'); win.destroy(); app.exit(0);
})().catch(e=>{console.error(e);app.exit(1);});
