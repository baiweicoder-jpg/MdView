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
      const exists=fs.existsSync(path.join(root,'src/table-controls.js'));
      require('esbuild').buildSync({stdin:{contents:`import {create} from './src/rich-editor.js'; ${exists ? "import {installTableControls} from './src/table-controls.js';" : ''} window.make=html=>{window.fixture=create(document.querySelector('#editor'),{source:'',editorHtml:html},()=>{});window.e=fixture.editor; ${exists ? 'window.controls=installTableControls(e);' : ''}};`,resolveDir:root},bundle:true,platform:'browser',outfile:path.join(scratch,'fixture.js')});
      const css=pathToFileURL(path.join(root,'src/table-controls.css')).href;
      const csp=fs.readFileSync(path.join(root,'src/index.html'),'utf8').match(/content="(default-src[^"]+)"/)[1];
      fs.writeFileSync(path.join(scratch,'index.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="${css}"><script src="fixture.js" defer></script></head><body><div id="editor"></div></body></html>`);
      win=new BrowserWindow({show:false,width:900,height:700,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
      await win.loadFile(path.join(scratch,'index.html'));
      const run=code=>win.webContents.executeJavaScript(code,true);
      await run(`window.original='<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td><td>e</td><td>f</td></tr><tr><td>g</td><td>h</td><td>i</td></tr></table>'; make(original);`);
      await new Promise(resolve=>setTimeout(resolve,50));
      await run(`window.tableViolations=[]; document.addEventListener('securitypolicyviolation',event=>tableViolations.push(event.violatedDirective));`);
      await checks(run);
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
      await run('fixture.destroy()');
      assert.equal(await run('document.querySelectorAll(".table-context-menu").length'),0);
      console.log('PASS table controls: native Shift ranges/right-click preservation, multi-row/column delete, middle insertion all directions, header promotion, undo, bounded bilingual menu, dismissal, disk save/reopen twice, cleanup');
    } catch(error) {console.error(error);process.exitCode=1;}
    finally {win?.destroy();app.exit(process.exitCode||0);}
  });
}
