const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {app,clipboard}=require('electron');
const dir=fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'),'mdview-merge-'));
app.setPath('userData',path.join(dir,'profile'));app.disableHardwareAcceleration();
app.on('browser-window-created',(_e,w)=>{w.setOpacity(0);w.setFocusable(false);w.setIgnoreMouseEvents(true);w.setSkipTaskbar(true);w.webContents.setBackgroundThrottling(false);w.showInactive();});
(async()=>{
 const {win,editSession}=await require('../src/main.cjs');
 // Disable throttling on the loaded renderer as well as the native window.
 win.webContents.setBackgroundThrottling(false);
 const run=code=>win.webContents.executeJavaScript(code,true);
 const wait=async code=>{for(let i=0;i<200;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,20));}assert.fail(code);};
 await wait('!!currentDocument && !restoringView');
 const file=path.join(dir,'merge.md');
 const source='{table-widths=140,260}\n\n| Field | URL |\n| :--- | ---: |\n| upper | value |\n\n{table-widths=400,500}\n\n| **FIRST DATA** | [Target](https://example.invalid/a?x=%2F#part) |\n| --- | --- |\n| last | ![diagram](synthetic.png) |\n';
 fs.writeFileSync(file,source);editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));
 await wait('currentDocument?.name==="merge.md" && !restoringView');
 if(!await run('editing'))await run('toggleEditing()');await wait('editing && !!richEditor && !restoringView');
 await run(`window.e=richEditor.editor;window.tableCell=(t,r,c)=>e.view.dom.querySelectorAll('table')[t].querySelectorAll('tr')[r].children[c];window.contextCell=(t,r,c)=>tableCell(t,r,c).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:300,clientY:200}));window.tableAction=name=>document.querySelector('[data-table-action="'+name+'"]').click();void 0;`);
 // Regression: an existing CellSelection must not redirect a different target's action.
 await run(`contextCell(0,1,0);tableAction('selectRows');contextCell(1,1,0);tableAction('deleteRow');`);
 assert.equal(await run('e.view.dom.querySelectorAll("table")[0].querySelectorAll("tr").length'),2,'cross-table context delete must not delete original selected row');
 assert.equal(await run('e.view.dom.querySelectorAll("table")[1].querySelectorAll("tr").length'),1,'cross-table context delete targets clicked row');
 await run('e.commands.undo();contextCell(0,0,0);tableAction("selectRows");contextCell(0,1,0);tableAction("deleteRow")');
 assert.equal(await run('e.view.dom.querySelector("table").textContent.includes("Field")'),true,'same-table unselected row must not delete selected header');
 assert.equal(await run('e.view.dom.querySelector("table").textContent.includes("upper")'),false);
 await run('e.commands.undo();contextCell(0,1,0);tableAction("selectRows");window.selectionBefore=JSON.stringify(e.state.selection.toJSON());contextCell(0,1,1)');
 await wait('!!document.querySelector("[data-plaintext-copy=plain]")');
 await run('document.querySelector("[data-plaintext-copy=plain]").click()');await wait('!document.querySelector(".table-context-menu")');
 assert.equal((await clipboard.readText()).replace(/\r\n/g,'\n'),'upper\tvalue');
 assert.equal(await run('JSON.stringify(e.state.selection.toJSON())'),await run('selectionBefore'),'copy inside selected cells preserves selection');
 // Text selections in table A also must not preserve the selection for B.
 await run(`(()=>{let p;e.state.doc.descendants((n,pos)=>{if(n.isText&&n.text==='upper')p=pos;});e.commands.setTextSelection({from:p,to:p+5});e.view.focus();})();contextCell(1,1,0);tableAction('deleteRow');`);
 assert.equal(await run('e.view.dom.querySelector("table").querySelectorAll("tr").length'),2,'text range outside context target is not preserved');
 await run('e.commands.undo();contextCell(0,1,0);tableAction("selectRows");contextCell(1,0,0)');
 assert.equal(await run('document.querySelector("[data-table-action=mergeAbove]").disabled'),false);
 assert.equal(await run('document.querySelector("[data-table-action=mergeBelow]").disabled'),true);
 const before=await run('e.getJSON()');
 await run('tableAction("mergeAbove")');
 assert.equal(await run('e.view.dom.querySelectorAll("table").length'),1);assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4);
 assert.equal(await run('e.view.dom.querySelectorAll("th").length'),2);
 assert.equal(await run('e.view.dom.querySelectorAll("tr")[2].textContent'), 'FIRST DATATarget');
 assert.equal(await run('e.view.dom.querySelectorAll("tr")[2].querySelector("strong").textContent'),'FIRST DATA');
 assert.equal(await run('e.view.dom.querySelectorAll("tr")[2].querySelector("a").getAttribute("href")'),'https://example.invalid/a?x=%2F#part');
 assert.equal(await run('e.view.dom.querySelectorAll("tr")[3].querySelector("[data-image-source]").dataset.imageSource'),'synthetic.png');
 assert.equal(await run('e.getJSON().content.filter(n=>n.type==="table")[0].content.every(r=>r.content.every((c,i)=>c.attrs.colwidth[0]===[140,260][i]))'),true);
 await run('e.commands.undo()');assert.deepEqual(await run('e.getJSON()'),before);await run('e.commands.redo()');
 await run('saveDocument()');await wait('!fileBusy');
 const saved=fs.readFileSync(file,'utf8');assert.match(saved,/FIRST DATA/);assert.match(saved,/\{table-widths=140,260\}/);assert.doesNotMatch(saved,/400,500/);assert.ok(saved.includes('https://example.invalid/a?x=%2F#part'));assert.match(saved,/synthetic\.png/);
 const reopened=await require('../src/markdown.cjs').readDocument(file);assert.equal((reopened.editorHtml.match(/<table\b/g)||[]).length,1);
 editSession.openDocument(reopened);await wait('!restoringView && currentDocument.source.includes("FIRST DATA")');
 if(!await run('editing'))await run('toggleEditing()');await wait('editing && !!richEditor && !restoringView');
 assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("tr").length'),4);
 assert.deepEqual(await run('[...richEditor.editor.view.dom.querySelectorAll("col")].map(c=>c.style.width)'),['140px','260px'],'reopened editor widths');
 await run('toggleEditing()');await wait('!editing && !restoringView');
 assert.equal(await run('document.querySelectorAll("#content table").length'),1);
 assert.deepEqual(await run('[...document.querySelectorAll("#content table col")].map(c=>c.getAttribute("width"))'),['140','260'],'reopened reader widths');
 await run('toggleEditing()');await wait('editing && !restoringView');
 // Disable explanations: different column counts, content/code/nested boundaries.
 for(const gap of ['<p>meaningful</p>','<pre><code>code</code></pre>']){
   await run(`e=richEditor.editor;e.commands.setContent('<table><tr><th>A</th><th>B</th></tr></table>'+${JSON.stringify(gap)}+'<table><tr><th>C</th><th>D</th></tr></table>');contextCell(0,0,0)`);
   assert.equal(await run('document.querySelector("[data-table-action=mergeBelow]").disabled'),true);
 }
 await run(`e.commands.setContent('<table><tr><th>A</th></tr></table><p></p><table><tr><th>B</th><th>C</th></tr></table>');contextCell(0,0,0)`);
 assert.equal(await run('document.querySelector("[data-table-action=mergeBelow]").disabled'),true);assert.match(await run('document.querySelector("[data-table-action=mergeBelow]").title'),/列数|column/);
 await run(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));e.setEditable(false);contextCell(0,0,0)`);assert.equal(await run('!!document.querySelector(".table-context-menu")'),false);
 console.log('TABLE MERGE PASS: cross/same-table context targeting, selected-cell copy, lower first data+marks+link+image, widths, undo/redo, IPC save/read/reopen, rejected boundaries');
 win.destroy();app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
