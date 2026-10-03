// Run directly with Electron; exports the same checks for a main-window harness.
const assert = require('node:assert/strict');
async function checks(run) {
  await run(`window.cell=(r,c)=>e.view.dom.querySelectorAll('tr')[r].children[c];
    window.context=(r,c)=>cell(r,c).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:innerWidth-2,clientY:innerHeight-2}));
    window.action=name=>document.querySelector('[data-table-action="'+name+'"]').click();
    context(1,0);`);
  assert.equal(await run("!!document.querySelector('[data-table-action=selectRows]')"), true, 'table context menu exists');
  await run("action('selectRows'); cell(2,1).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,shiftKey:true}));");
  assert.equal(await run('e.state.selection.isRowSelection()'), true);
  assert.equal(await run('e.view.dom.querySelectorAll(".selectedCell").length'), 6);
  await run("context(2,1); action('deleteRow')");
  assert.deepEqual(await run('Array.from(e.view.dom.querySelectorAll("tr"),r=>r.textContent)'), ['ABC','g hi'.replaceAll(' ','')]);
  await run('e.commands.undo(); e.commands.setTextSelection(4)');
  assert.equal(await run('e.view.dom.querySelectorAll("tr").length'), 4);
  await run("context(1,2); action('selectColumns'); cell(2,1).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,shiftKey:true}));");
  assert.equal(await run('e.state.selection.isColSelection()'), true);
  assert.equal(await run('e.view.dom.querySelectorAll(".selectedCell").length'), 8);
  await run(`cell(1,1).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:2})); context(1,1);`);
  assert.equal(await run('e.view.dom.querySelectorAll(".selectedCell").length'), 8, 'right mousedown preserves column selection');
  assert.equal(await run(`(()=>{const r=document.querySelector('.table-context-menu').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`), true);
  await run("action('deleteColumn')");
  assert.deepEqual(await run('Array.from(e.view.dom.querySelectorAll("tr"),r=>r.textContent)'), ['A','a','d','g']);
  await run('e.commands.undo(); e.commands.setTextSelection(4)');
  for (const [command, expected] of [['addRowBefore',['ABC','abc','','def','ghi']], ['addRowAfter',['ABC','abc','def','','ghi']]]) {
    await run(`context(2,1); action('${command}')`);
    assert.deepEqual(await run('Array.from(e.view.dom.querySelectorAll("tr"),r=>r.textContent)'), expected, command+' inserts in middle');
    await run('e.commands.undo(); e.commands.setTextSelection(4)');
  }
  for (const [command, expected] of [['addColumnBefore',['a','','b','c']], ['addColumnAfter',['a','b','','c']]]) {
    await run(`context(1,1); action('${command}')`);
    assert.deepEqual(await run('Array.from(e.view.dom.querySelectorAll("tr")[1].children,c=>c.textContent)'), expected);
    await run('e.commands.undo(); e.commands.setTextSelection(4)');
  }
  await run("context(0,0)");
  assert.equal(await run('!!document.querySelector("[data-table-row-count]")'), true, 'row amount input exists');
  for (const amount of ['0','101','1.5','-1','abc','']) {
    await run(`document.querySelector('[data-table-row-count]').value=${JSON.stringify(amount)}; action('addRowBefore')`);
    assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4,'invalid amount rejected '+amount);
    assert.equal(await run('!!document.querySelector(".table-context-menu")'),true,'invalid menu stays open');
  }
  await run("document.querySelector('[data-table-row-count]').value='3'; action('addRowBefore')");
  assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),7,'inserts exact count');
  assert.equal(await run('e.view.dom.querySelectorAll("th").length'),3,'one header only');
  await run('e.commands.undo()');
  assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4,'batch insertion is one undo');
  await run("context(0,0); action('addRowBefore')");
  assert.equal(await run('e.view.dom.querySelectorAll("tr")[0].querySelectorAll("th").length'), 3);
  assert.equal(await run('e.view.dom.querySelectorAll("tr")[1].querySelectorAll("td").length'), 3);
  await run('e.commands.undo(); e.commands.setTextSelection(4)');
  await run("context(0,0); action('deleteRow')");
  assert.equal(await run('e.view.dom.querySelectorAll("tr")[0].textContent'), 'abc');
  assert.equal(await run('e.view.dom.querySelectorAll("tr")[0].querySelectorAll("th").length'), 3, 'deleting header promotes next row');
  await run('e.commands.undo(); e.commands.setTextSelection(4)');
  await run("context(1,0); document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");
  assert.equal(await run('!!document.querySelector(".table-context-menu")'), false);
  await run("context(1,0); document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));");
  assert.equal(await run('!!document.querySelector(".table-context-menu")'), false);
  await run("document.documentElement.lang='zh-CN'; context(1,0)");
  assert.equal(await run('document.querySelector("[data-table-action=selectRows]").textContent'), '选择行');
  await run("action('addRowAfter'); document.documentElement.lang='en';");
  assert.equal(await run('e.getMarkdown().includes("A")'), true);
}
module.exports = checks;
if (process.argv.some(arg => /table-controls-smoke\.cjs$/.test(arg))) {
  const {app,BrowserWindow}=require('electron'); const fs=require('node:fs'); const path=require('node:path'); const {pathToFileURL}=require('node:url');
  const scratch=fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'),'mdview-table-'));
  app.setPath('userData',path.join(scratch,'profile'));
  app.whenReady().then(async()=>{
    let win;
    try {
      const root=path.resolve(__dirname,'..');
      require('esbuild').buildSync({stdin:{contents:`import {create} from './src/rich-editor.js'; import {cellAround} from '@tiptap/pm/tables'; import {undoDepth,redoDepth} from '@tiptap/pm/history'; window.fixtureHistory=()=>({undo:undoDepth(e.state),redo:redoDepth(e.state)}); window.make=html=>{window.fixture=create(document.querySelector('#editor'),{source:'',editorHtml:html},()=>{});window.e=fixture.editor;}; window.selectCells=(r,c,r2,c2)=>{const pos=(r,c)=>cellAround(e.state.doc.resolve(e.view.posAtDOM(cell(r,c),0))).pos;e.commands.setCellSelection({anchorCell:pos(r,c),headCell:pos(r2,c2)});e.view.focus();};`,resolveDir:root},bundle:true,platform:'browser',outfile:path.join(scratch,'fixture.js')});
      const css=pathToFileURL(path.join(root,'src/table-controls.css')).href;
      const themeCss = ['style.css','review-theme.css','sky-theme.css'].map(name=>`<link rel="stylesheet" href="${pathToFileURL(path.join(root,'src',name)).href}">`).join('');
      const csp=fs.readFileSync(path.join(root,'src/index.html'),'utf8').match(/content="(default-src[^"]+)"/)[1];
      fs.writeFileSync(path.join(scratch,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${themeCss}<link rel="stylesheet" href="${css}"><script src="fixture.js" defer></script></head><body><div id="editor" class="markdown"></div></body></html>`);
      win=new BrowserWindow({show:false,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
      win.webContents.on('console-message',event=>{ if(event.level==='error') console.error(event.message); });
      await win.loadFile(path.join(scratch,'index.html'));
      const run=code=>win.webContents.executeJavaScript(`try { ${code} } catch(error) { console.error(error.stack); throw error; }`,true);
      await run(`window.original='<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr><tr><td>g</td><td>h</td><td>i</td></tr></table>'; make(original);`);
      await new Promise(resolve=>setTimeout(resolve,50));
      await run(`window.tableViolations=[]; document.addEventListener('securitypolicyviolation',event=>tableViolations.push(event.violatedDirective));`);
      assert.equal(await run('e.view.dom.querySelectorAll("[data-insert-column]").length'),4,'one insertion target at every column boundary');
      assert.equal(await run('e.view.dom.querySelectorAll("[data-insert-row]").length'),5,'one insertion target at every row boundary');
      await checks(run);
      await run('context(0,0)');
      assert.equal(await run('document.querySelectorAll("[data-table-action^=merge]").length'),0,'no table merge actions');
      assert.deepEqual(await run('tableViolations'),[],'menu introduces no CSP violations');
      assert.equal(await run(`(()=>{context(1,0);action('selectRows');return getComputedStyle(e.view.dom.querySelector('.selectedCell'),'::after').backgroundColor !== 'rgba(0, 0, 0, 0)'})()`),true,'cell selection is visibly painted');
      await run('e.commands.setTextSelection(4)');
      // Actual Chromium mouse input verifies native default selection behavior.
      const point = (r,c) => run(`(()=>{const b=cell(${r},${c}).getBoundingClientRect();return {x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
      const mouse = async (r,c,button,modifiers=[]) => {
        const p=await point(r,c); win.webContents.sendInputEvent({type:'mouseDown',...p,button,clickCount:1,modifiers});
        win.webContents.sendInputEvent({type:'mouseUp',...p,button,clickCount:1,modifiers});
        await new Promise(resolve=>setTimeout(resolve,60));
      };
      await mouse(1,0,'right'); await run("action('selectRows')");
      await mouse(3,1,'left',['shift']);
      assert.equal(await run('e.view.dom.querySelectorAll(".selectedCell").length'),9,'native Shift-click extends three rows');
      await mouse(2,0,'right');
      assert.equal(await run('e.view.dom.querySelectorAll(".selectedCell").length'),9,'native right-click keeps range');
      await run("action('deleteRow')");
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),2);
      await run('e.commands.undo()');
      const snapshot=await run('e.getMarkdown()');
      const disk=path.join(scratch,'saved.md'); fs.writeFileSync(disk,snapshot);
      const restored=require('../src/markdown.cjs').renderEditorHtml(fs.readFileSync(disk,'utf8'));
      await run(`fixture.destroy(); make(${JSON.stringify(restored)});`);
      assert.equal(await run('e.getMarkdown()'),snapshot,'disk save and new-editor reopen preserve table');
      await run("context(1,1); action('addColumnBefore')");
      const second=await run('e.getMarkdown()'); fs.writeFileSync(disk,second);
      await run(`fixture.destroy(); make(${JSON.stringify(require('../src/markdown.cjs').renderEditorHtml(fs.readFileSync(disk,'utf8')))});`);
      assert.equal(await run('e.getMarkdown()'),second,'second save/reopen remains stable');
      const key = async keyCode => {
        win.webContents.sendInputEvent({type:'keyDown',keyCode});
        win.webContents.sendInputEvent({type:'keyUp',keyCode});
        await new Promise(resolve=>setTimeout(resolve,60));
      };
      const reset = async html => { await run(`fixture.destroy(); make(${JSON.stringify(html)}); e.view.focus();`); };
      const blankBottom='<p>before</p><table><tr><th>A</th><th>B</th></tr><tr><td>a</td><td>b</td></tr><tr><td></td><td></td></tr></table><p>after</p>';
      await reset(blankBottom);
      await run('selectCells(2,0,2,1); e.view.dom.addEventListener("keydown",event=>window.deletionEvent=event,{capture:true,once:true})');
      await key('Backspace');
      assert.deepEqual(await run('({trusted:deletionEvent.isTrusted,prevented:deletionEvent.defaultPrevented})'),{trusted:true,prevented:true},'native key is consumed (no browser navigation)');
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),2,'Backspace removes selected whole blank bottom row');
      assert.deepEqual(await run('Array.from(e.view.dom.children).filter(n=>n.tagName==="P").map(n=>n.textContent)'),['before','after']);
      assert.equal(await run('document.activeElement===e.view.dom'),true,'deletion retains editor focus');
      const deleted=await run('fixture.source()');
      assert.equal(deleted,await run('e.getMarkdown()'),'production source wrapper observes structural deletion');
      await run('e.commands.undo()');
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),3,'one undo restores blank row');
      await run('e.commands.redo()');
      assert.equal(await run('e.getMarkdown()'),deleted,'one redo removes row');
      fs.writeFileSync(disk,deleted);
      await reset(require('../src/markdown.cjs').renderEditorHtml(fs.readFileSync(disk,'utf8')));
      assert.equal(await run('e.getMarkdown()'),deleted,'keyboard deletion survives disk reopen');
      const original=await run('original');
      for (const keyCode of ['Backspace','Delete']) {
        await reset(original);
        const before=await run('e.getJSON()');
        await run('selectCells(1,0,2,2)');
        await key(keyCode);
        assert.deepEqual(await run('Array.from(e.view.dom.querySelectorAll("tr"),r=>r.textContent)'),['ABC','ghi'],keyCode+' deletes middle rows');
        await run('e.commands.undo()');
        assert.deepEqual(await run('e.getJSON()'),before,'single undo restores exact model');
        await run('e.commands.setTextSelection(4); selectCells(0,1,3,2)');
        await key(keyCode);
        assert.deepEqual(await run('Array.from(e.view.dom.querySelectorAll("tr"),r=>r.textContent)'),['A','a','d','g'],keyCode+' deletes whole columns');
        await reset(original);
        await run('selectCells(0,0,0,2)');
        await key(keyCode);
        assert.equal(await run('e.view.dom.querySelector("tr").textContent'),'abc');
        assert.equal(await run('e.view.dom.querySelectorAll("th").length'),3,'header promotion');
        await run('e.commands.undo()');
        assert.deepEqual(await run('e.getJSON()'),before,'header promotion shares undo event');
        await reset(original);
        await run('selectCells(1,0,2,1)');
        await key(keyCode);
        assert.deepEqual(await run('Array.from(e.view.dom.querySelectorAll("tr"),r=>Array.from(r.children,c=>c.textContent))'),[['A','B','C'],['','','c'],['','','f'],['g','h','i']],keyCode+' partial rectangle only clears cells');
        for (const html of [original,'<table><tr><th>A</th><th>B</th></tr></table>','<table><tr><th>A</th></tr><tr><td>a</td></tr></table>']) {
          await reset(html);
          const model=await run('e.getJSON()');
          await run('selectCells(0,0,e.view.dom.querySelectorAll("tr").length-1,cell(0,0).parentElement.children.length-1)');
          await key(keyCode);
          assert.equal(await run('e.view.dom.querySelectorAll("table").length'),0,'whole table / last axis removed');
          assert.equal(await run('e.state.doc.check(); e.state.doc.firstChild.type.name'),'paragraph','schema-valid fallback');
          await run('e.commands.undo()');
          assert.deepEqual(await run('e.getJSON()'),model);
        }
        await reset('<p>abcdef</p>'+original);
        await run('e.commands.setTextSelection({from:2,to:5}); e.view.focus()');
        await key(keyCode);
        assert.equal(await run('e.view.dom.querySelector("p").textContent'),'aef','text range deletes text only');
        assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4);
        await reset(original.replace('<td>a</td>','<td>abcdef</td>'));
        await run('(()=>{const start=e.view.posAtDOM(cell(1,0).querySelector("p"),0);e.commands.setTextSelection({from:start+1,to:start+4});e.view.focus()})()');
        await key(keyCode);
        assert.equal(await run('cell(1,0).textContent'),'aef','cell text selection deletes text, not row');
        assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4);
      }
      // Context-axis selection takes the same keyboard route as a dragged rectangle.
      await reset(original);
      await run("context(1,0); action('selectRows'); cell(2,1).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,shiftKey:true}));");
      await key('Delete');
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),2);
      await reset(original);
      await run('selectCells(1,0,1,2); e.setEditable(false)');
      const protectedModel=await run('e.getJSON()');
      await key('Backspace');
      assert.deepEqual(await run('e.getJSON()'),protectedModel,'read-only cannot delete');
      await run('e.setEditable(true); selectCells(1,0,1,2); e.view.input.composing=true');
      await key('Backspace');
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4,'IME Backspace cannot delete structure');
      await run('e.view.input.composing=false');
      await reset(original);
      await run('selectCells(1,0,1,2); window.input=document.createElement("input"); input.value="abc"; document.body.append(input); input.focus(); input.setSelectionRange(3,3)');
      await key('Backspace');
      assert.equal(await run('input.value'),'ab','focused input receives Backspace');
      assert.deepEqual(await run('e.getJSON()'),protectedModel,'outside input cannot delete stale table selection');
      await run('input.remove()');
      for (const html of ['<p>abc</p>','<pre><code>abc</code></pre>','<ul><li><p>abc</p></li></ul>']) {
        await reset(html);
        await run('(()=>{let end; e.state.doc.descendants((n,p)=>{if(n.isText)end=p+n.nodeSize});e.commands.setTextSelection(end);e.view.focus()})()');
        await key('Backspace');
        assert.equal(await run('e.getText().trim()'),'ab','ordinary caret/code/list Backspace unchanged');
      }
      await reset(original);
      await run("context(1,0); document.querySelector('[data-table-row-count]').focus()");
      await key('Up');
      assert.equal(await run('document.querySelector("[data-table-row-count]").value'),'2','native number input arrow is not menu navigation');
      await run("action('addRowAfter')");
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),6,'native input count inserts two rows');
      await run('e.commands.undo()');
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4,'one undo restores count insertion');
      await run("context(2,1); document.querySelector('[data-table-row-count]').value='100'; action('addRowAfter')");
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),104,'maximum amount is not truncated');
      await run('e.commands.undo()');
      const enter = async modifiers => {
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter',modifiers});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter',modifiers});
        await new Promise(resolve=>setTimeout(resolve,50));
      };
      await reset(original);
      await run('window.caret=(r,c)=>{e.commands.setTextSelection(e.view.posAtDOM(cell(r,c).querySelector("p"),0)); e.view.focus()}; caret(3,1)');
      await enter([]);
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),5,'plain last-row Enter adds one row');
      assert.equal(await run('e.state.selection.$from.index(-2)'),1,'new row keeps corresponding column');
      await run('e.commands.undo()');
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4);
      await run('caret(3,2)'); await enter(['shift']);
      assert.equal(await run('e.state.selection.$from.depth'),1,'Shift Enter exits below');
      assert.equal(await run('e.state.selection.$from.before()>0'),true);
      const exitSize=await run('e.state.doc.childCount');
      await run('caret(3,2)'); await enter(['shift']);
      assert.equal(await run('e.state.doc.childCount'),exitSize,'reuse empty paragraph below');
      await run('caret(0,1)'); await enter(['control']);
      assert.equal(await run('e.state.selection.$from.before()'),0,'Ctrl Enter exits above header');
      const aboveSize=await run('e.state.doc.childCount');
      await run('caret(0,1)'); await enter(['control']);
      assert.equal(await run('e.state.doc.childCount'),aboveSize,'reuse empty paragraph above');
      await reset(original); await run('caret(0,1)'); await enter([]);
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4,'Enter elsewhere keeps default behavior');
      await run('caret(1,1)'); await enter(['shift']);
      assert.equal(await run('e.state.selection.$from.parent.type.name'),'paragraph');
      assert.equal(await run('e.state.selection.$from.depth'),4,'middle Shift Enter remains inside table');
      await reset(original); await run('caret(3,0)'); await enter([]); await enter([]);
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),6,'each repeated Enter appends exactly one row');
      await reset('<pre><code>abc</code></pre>'); await run('e.commands.setTextSelection(4); e.view.focus()'); await enter([]);
      assert.equal(await run('e.state.doc.firstChild.textContent'),'abc\n','code Enter still inserts newline');
      await enter(['control']);
      assert.equal(await run('e.state.selection.$from.parent.type.name'),'paragraph','code Ctrl Enter still exits code');
      await reset(original); await run('caret(3,1); e.view.input.composing=true'); await enter([]);
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4,'IME Enter does not add row');
      await run('e.view.input.composing=false; e.setEditable(false)'); await enter([]);
      assert.equal(await run('e.view.dom.querySelectorAll("tr").length'),4,'read-only Enter does not add row');
      await require('./table-perimeter-checks.cjs')({run,win,reset,scratch,fs,path});
      await reset(require('../src/markdown.cjs').renderEditorHtml('{table-widths=120,240}\n\n| A | B |\n| :--- | ---: |\n| a | b |'));
      assert.match(await run('e.getMarkdown()'), /\{table-widths=120,240\}/, 'widths serialize safely');
      assert.match(await run('e.getMarkdown()'), /:--/, 'column alignment survives');
      assert.deepEqual(await run('e.markdown.parse(e.getMarkdown()).content.find(n=>n.type==="table").content[0].content.map(n=>n.attrs.colwidth)'),[[120],[240]],'Tiptap Markdown tokenizer also roundtrips widths');
      assert.equal(await run('e.view.dom.querySelectorAll("[data-resize-column]").length'),2,'accessible column handles');
      await run("context(0,0); document.querySelector('[data-table-row-count]').value='2'; action('addRowBefore')");
      assert.deepEqual(await run('e.state.doc.firstChild.firstChild.content.content.map(c=>({align:c.attrs.align,width:c.attrs.colwidth}))'),[{align:'left',width:[120]},{align:'right',width:[240]}],'new header inherits alignment and widths');
      await run('e.commands.undo()');
      const beforeResize = await run('e.getMarkdown()');
      const dragWidth = async (selector,dx,cancel=false) => {
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const p = await run(`(()=>{const r=e.view.dom.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);

        win.webContents.sendInputEvent({type:'mouseMove',...p});
        win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});
        await new Promise(resolve=>setTimeout(resolve,30));
        win.webContents.sendInputEvent({type:'mouseMove',x:p.x+dx,y:p.y,button:'left',modifiers:['leftButtonDown']});
        await new Promise(resolve=>setTimeout(resolve,30));
        if(cancel) await key('Escape');
        win.webContents.sendInputEvent({type:'mouseUp',x:p.x+dx,y:p.y,button:'left',clickCount:1});
        await new Promise(resolve=>setTimeout(resolve,80));
      };
      await dragWidth('[data-resize-column="0"]',60,true);
      assert.equal(await run('e.getMarkdown()'),beforeResize,'Escape cancels native drag without source change');
      await dragWidth('[data-resize-column="0"]',60);

      assert.match(await run('e.getMarkdown()'),/\{table-widths=180,240\}/,'native pointer resizes column and total');
      await run('e.commands.undo()'); assert.equal(await run('e.getMarkdown()'),beforeResize,'drag is one undo');
      await run('e.commands.redo()');
      const resized = await run('e.getMarkdown()'); fs.writeFileSync(disk,resized);
      await reset(require('../src/markdown.cjs').renderEditorHtml(fs.readFileSync(disk,'utf8')));
      assert.equal(await run('e.getMarkdown()'),resized,'width disk persistence');
      await dragWidth('[data-resize-table]',140);
      assert.match(await run('e.getMarkdown()'),/\{table-widths=240,320\}/,'overall drag proportionally resizes table');
      const widthSource = await run('e.getMarkdown()');
      const readerHtml = (await require('../src/markdown.cjs').renderMarkdown(widthSource)).html;
      await run(`window.reader=document.createElement('div'); reader.className='markdown'; reader.innerHTML=${JSON.stringify(readerHtml)}; document.body.append(reader); document.querySelector('#editor').style.width='280px'; reader.style.width='280px';`);
      for (const theme of ['light','dark','review','sky']) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        const layout=await run(`(()=>{const edit=e.view.dom.querySelector('table'),read=reader.querySelector('table'),wrap=edit.closest('.mdview-table-scroll');return {edit:edit.getBoundingClientRect().width,read:read.getBoundingClientRect().width,overflow:wrap.scrollWidth>wrap.clientWidth,scroll:getComputedStyle(wrap).overflowX,handle:getComputedStyle(e.view.dom.querySelector('[data-resize-column]')).borderRightWidth}})()`);
        assert.ok(Math.abs(layout.edit-layout.read)<2,'read/edit width parity '+theme+JSON.stringify(layout));
        assert.ok(layout.edit>=560 && layout.overflow && layout.scroll==='auto','narrow overflow remains accessible '+theme);
        assert.equal(await run('getComputedStyle(e.view.dom.querySelector("[data-resize-column]")).cursor'), 'col-resize', 'direct column boundary '+theme);
        for (const state of ['hover', 'focus']) {
          await run('document.activeElement.blur();e.view.dom.querySelector("[data-resize-column]").scrollIntoView({block:"nearest",inline:"center",behavior:"instant"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          const p=await run('(()=>{const r=e.view.dom.querySelector("[data-resize-column]").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()');
          win.webContents.sendInputEvent({type:'mouseMove',...(state==='hover'?p:{x:1,y:1})});
          if(state==='focus') { await key('Tab'); await run('e.view.dom.querySelector("[data-resize-column]").focus()'); }
          await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          const visual=await run(`(()=>{const h=e.view.dom.querySelector('[data-resize-column]'),s=getComputedStyle(h,'::after');return {active:h.matches('${state==='hover'?':hover':':focus-visible'}'),width:parseFloat(s.width),height:parseFloat(s.height),color:s.backgroundColor,opacity:getComputedStyle(h.closest('.table-width-controls')).opacity}})()`);
          assert.equal(visual.active,true,`${theme} ${state} actually active`);
          assert.ok(visual.width>=2 && visual.height>0,`${theme} ${state} painted boundary thickness: ${JSON.stringify(visual)}`);
          assert.notEqual(visual.color,'transparent',`${theme} ${state} boundary color`);
          assert.ok(!visual.color.startsWith('rgba(') || parseFloat(visual.color.split(',').at(-1))>0,`${theme} ${state} boundary has positive alpha`);
          assert.notEqual(visual.color,'rgba(0, 0, 0, 0)',`${theme} ${state} boundary is not transparent`);
          assert.equal(visual.opacity,'1',`${theme} ${state} parent is visible`);
        }
      }
      await run('reader.remove(); document.querySelector("#editor").style.width=""; e.view.dom.querySelector("[data-resize-column]").focus()');
      await key('Left');
      assert.match(await run('e.getMarkdown()'),/\{table-widths=230,320\}/,'keyboard resize available');
      for(let i=0;i<5;i++) {
        win.webContents.sendInputEvent({type:'keyDown',keyCode:'Left',modifiers:['shift']});
        win.webContents.sendInputEvent({type:'keyUp',keyCode:'Left',modifiers:['shift']});
      }
      await new Promise(resolve=>setTimeout(resolve,80));
      assert.match(await run('e.getMarkdown()'),/\{table-widths=50,320\}/,'minimum column width is enforced');
      assert.ok(await run('cell(0,0).getBoundingClientRect().width>=49'),'minimum cell remains visible');
      await run('e.view.dom.querySelector(".table-width-controls > button:nth-child(2)").click()');
      assert.doesNotMatch(await run('e.getMarkdown()'),/table-widths/,'automatic width removes metadata');
      await run('e.commands.undo()');
      assert.match(await run('e.getMarkdown()'),/\{table-widths=50,320\}/,'reset is one undo');
      await run('e.setEditable(false)');
      assert.equal(await run('e.view.dom.querySelector(".table-width-controls").hidden'),true,'read-only controls hidden');
      assert.deepEqual(await run('tableViolations'),[],'production CSP stays clean across mount, resize and reopen');
      await run('fixture.destroy()');
      assert.equal(await run('document.querySelectorAll(".table-context-menu").length'),0);
      console.log('PASS table controls: production factory, native Backspace/Delete blank row/multi-axis/table removal, header promotion and one-step undo/redo, partial-cell clearing, text/caret/code/list isolation, read-only/IME/input guards, source and disk reopen, native Shift ranges/right-click preservation, middle insertion, bounded bilingual menu, CSP and cleanup');
    } catch(error) {console.error(error);process.exitCode=1;}
    finally {win?.destroy();app.exit(process.exitCode||0);}
  });
}
