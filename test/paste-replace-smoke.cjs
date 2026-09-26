const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow, clipboard, ClipboardItem } = require('electron');
const { renderMarkdown, readDocument } = require('../src/markdown.cjs');
const { saveTextFile } = require('../src/document-file.cjs');

async function smoke({ win, outputDirectory }) {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(r=>setTimeout(r,180))');
  const original = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  async function mount(source) {
    const doc = { source, ...await renderMarkdown(source) };
    await run(`window.replaceHarness?.destroy(); document.querySelector('#replace-harness')?.remove(); {const host=document.createElement('div'); host.id='replace-harness'; document.body.append(host); window.replaceHarness=MdViewRich.create(host,${JSON.stringify(doc)},()=>{}); replaceHarness.editor.view.focus();}`);
    await settle();
  }
  async function key(keyCode, modifiers = []) {
    win.webContents.sendInputEvent({type:'keyDown', keyCode, modifiers});
    win.webContents.sendInputEvent({type:'keyUp', keyCode, modifiers});
    await settle();
  }
  async function selectAll() {
    await run('replaceHarness.editor.view.focus()');
    await key('a', ['control']);
    const selection = await run('({from:replaceHarness.editor.state.selection.from,to:replaceHarness.editor.state.selection.to,size:replaceHarness.editor.state.doc.content.size,text:getSelection().toString(),type:replaceHarness.editor.state.selection.constructor.name})');
    console.log('Native Ctrl+A:', JSON.stringify(selection));
    assert.ok(selection.to > selection.from, 'native Ctrl+A selects content');
  }
  async function paste(formats) {
    await clipboard.write([new ClipboardItem(formats)]);
    await run('replaceHarness.editor.view.focus()');
    await run(`window.pasteEvents=[]; replaceHarness.editor.view.dom.addEventListener('paste',e=>pasteEvents.push({trusted:e.isTrusted,types:[...e.clipboardData.types]}),{once:true}); replaceHarness.editor.view.focus()`);
    await key('v', ['control']);
    assert.equal(await run('pasteEvents.length'), 1, 'real Ctrl+V dispatches a native paste');
    assert.equal(await run('pasteEvents[0].trusted'), true, 'paste event is native, not synthetic');
  }
  try {
    for (const source of ['const answer = 42;', '```js\nconst answer = 42;\n```', '# Old heading\n\nold paragraph\n\n- old list']) {
      await mount(source); await selectAll();
      await paste({'text/plain':'https://developer.zhihu.com/'});
      assert.equal(await run('replaceHarness.editor.getText()'), 'https://developer.zhihu.com/', 'Ctrl+A then Ctrl+V replaces all original text');
      assert.equal(await run('replaceHarness.editor.view.dom.querySelectorAll("h1,li,pre").length'), 0, 'text replacement leaves no old block nodes');
      const file = path.join(outputDirectory,'text-replacement.md');
      await fs.rm(file,{force:true});
      await saveTextFile(file,await run('replaceHarness.source()'),{expectedHash:null});
      assert.equal((await readDocument(file)).source.includes('const answer'),false,'disk source contains no old code');
      await run('replaceHarness.editor.commands.undo()');
      assert.equal(await run('replaceHarness.source()'), source, 'one undo restores original document');
    }
    for (const replacement of ['NEW','https://developer.zhihu.com/']) {
      await mount('left TARGET right');
      await run('replaceHarness.editor.commands.setTextSelection({from:6,to:12})');
      await paste({'text/plain':replacement});
      assert.equal(await run('replaceHarness.editor.getText()'), `left ${replacement} right`);
      await run('replaceHarness.editor.commands.undo()');
      assert.equal(await run('replaceHarness.source()'), 'left TARGET right');
    }
    await mount('old'); await selectAll();
    await paste({'text/html':'<p><strong>safe</strong><script>window.pasteUnsafe=true</script><iframe src="https://example.com"></iframe></p>','text/plain':'safe'});
    assert.equal(await run('replaceHarness.editor.getText()'), 'safe');
    assert.equal(await run('!!window.pasteUnsafe || !!replaceHarness.editor.view.dom.querySelector("script,iframe")'), false, 'HTML remains schema restricted');
    const image = (await win.webContents.capturePage()).resize({width:64,height:48}).toPNG();
    const png = () => ({'image/png': new Blob([image],{type:'image/png'})});
    for (const source of ['old text', '# old heading\n\nold paragraph\n\n- old list', '```js\nconst answer = 42;\n```']) {
      await mount(source); await selectAll(); await paste(png());
      assert.equal(await run('replaceHarness.editor.getText().trim()'), '', 'PNG whole-document replacement removes all old text');
      assert.equal(await run('replaceHarness.editor.view.dom.querySelectorAll("img:not(.ProseMirror-separator)").length'), 1);
      assert.equal(await run('replaceHarness.editor.view.dom.querySelectorAll("h1,li,pre").length'), 0, 'no residual original block nodes');
      const saved = await run('replaceHarness.source()');
      await run('replaceHarness.editor.commands.undo()');
      assert.equal(await run('replaceHarness.source()'), source, 'PNG replacement undoes in one step');
      const file = path.join(outputDirectory,'replacement.md');
      await fs.rm(file,{force:true}); await saveTextFile(file,saved,{expectedHash:null});
      const reopened = await readDocument(file); await mount(reopened.source);
      assert.equal(await run('replaceHarness.editor.getText().trim()'), '');
      assert.equal(await run('replaceHarness.editor.view.dom.querySelector("img").naturalWidth'), 64);
    }
    for (const source of ['left TARGET right','left TARGET\n\nSECOND right']) {
      await mount(source);
      await run(`{const end=replaceHarness.editor.state.doc.content.size-7; replaceHarness.editor.commands.setTextSelection({from:6,to:end});}`);
      await paste(png());
      assert.equal(await run('replaceHarness.editor.getText()'),'left  right','PNG replaces a partial or cross-paragraph range');
      assert.equal(await run('replaceHarness.editor.view.dom.querySelectorAll("img:not(.ProseMirror-separator)").length'),1);
      await run('replaceHarness.editor.commands.undo()');
      assert.equal(await run('replaceHarness.source()'),source,'range replacement is one undo step');
    }
    await mount('left TARGET right');
    await run(`replaceHarness.editor.commands.setTextSelection({from:6,to:12}); replaceHarness.editor.view.dom.addEventListener('paste',()=>queueMicrotask(()=>{ replaceHarness.editor.commands.insertContentAt(1,'PREFIX '); replaceHarness.editor.commands.setTextSelection(replaceHarness.editor.state.doc.content.size-1); }),{once:true});`);
    await paste(png());
    assert.equal(await run('replaceHarness.editor.getText()'),'PREFIX left  right','async PNG replaces mapped original range, not later caret');
    await run('replaceHarness.editor.commands.undo()');
    assert.equal(await run('replaceHarness.editor.getText()'),'PREFIX left TARGET right','undo retains intervening edit');
    await mount('old'); await selectAll();
    await run(`replaceHarness.editor.view.dom.addEventListener('paste',()=>queueMicrotask(()=>{replaceHarness.destroy(); window.replaceHarness=MdViewRich.create(document.querySelector('#replace-harness'),{source:'new tab',editorHtml:'<p>new tab</p>'},()=>{});}),{once:true});`);
    await paste(png());
    assert.equal(await run('replaceHarness.source()'),'new tab','destroyed tab rejects late paste');
    console.log('Paste replacement smoke PASS: native Ctrl+A/Ctrl+V text, HTML, PNG, partial range, async mapping, undo, destruction and disk reopen');
  } finally {
    await run('window.replaceHarness?.destroy(); document.querySelector("#replace-harness")?.remove()');
    await clipboard.write(original);
  }
}
module.exports = smoke;
if (process.argv.some(arg => path.resolve(arg) === __filename)) {
  const root = process.env.MDVIEW_TEST_SCRATCH || 'I:/AI/Hermes/cache/scratch';
  require('node:fs').mkdirSync(root,{recursive:true});
  app.setPath('userData',require('node:fs').mkdtempSync(path.join(root,'replace-profile-')));
  app.whenReady().then(async()=>{
    let win;
    try {
      const dir = await fs.mkdtemp(path.join(root,'replace-paste-'));
      await require('esbuild').build({entryPoints:[path.join(__dirname,'../src/rich-editor.js')],outfile:path.join(dir,'editor.js'),bundle:true,platform:'browser',format:'iife',globalName:'MdViewRich'});
      await fs.writeFile(path.join(dir,'preload.cjs'),"const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('mdview',{pasteImage:bytes=>ipcRenderer.invoke('paste-image',bytes)});");
      await fs.writeFile(path.join(dir,'index.html'),`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; img-src data:; style-src 'self'"><link rel="stylesheet" href="style.css"><body><script src="editor.js"></script>`);
      await fs.copyFile(path.join(__dirname,'../src/style.css'),path.join(dir,'style.css'));
      win = new BrowserWindow({show:true,width:800,height:600,webPreferences:{preload:path.join(dir,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
      require('../src/image-paste.cjs').registerImagePaste(event=>event.sender===win.webContents && event.senderFrame===win.webContents.mainFrame);
      win.webContents.on('console-message',event=>console.log('Renderer:',event.message));
      const { Menu } = require('electron');
      Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Edit',submenu:[{role:'selectAll'},{role:'paste'},{role:'undo'}]}]));
      await win.loadFile(path.join(dir,'index.html')); win.focus();
      await smoke({win,outputDirectory:dir}); console.log('Artifacts:',dir); win.destroy(); app.exit(0);
    } catch(error) {console.error(error); win?.destroy(); app.exit(1);}
  });
}
