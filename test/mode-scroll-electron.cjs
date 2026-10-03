const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, Menu } = require('electron');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-mode-scroll-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
const timer = setTimeout(() => { console.error('mode scroll timeout'); app.exit(1); }, 90000);
(async () => {
  const { win, openDocument } = await require('../src/main.cjs');
  win.webContents.setBackgroundThrottling(false);
  win.setSize(1100, 780); win.show(); win.focus();
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),120))');
  const source = Array.from({ length: 36 }, (_, i) => `## Section ${i}\n\nParagraph ${i} ${'Long text with **bold** and inline code `value`. '.repeat(12)}\n\n- List ${i} first\n- List ${i} second\n\n> Quote ${i}\n\n![image ${i}](pixel.png)\n\n\`\`\`js\n// code ${i}\n${'console.log("hello");\n'.repeat(6)}\`\`\`\n\n| Column ${i} | Value |\n| --- | --- |\n| Cell ${i} | Text |\n\n`).join('');
  fs.writeFileSync(path.join(dir, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  const file = path.join(dir, 'mixed.md'); fs.writeFileSync(file, source);
  await openDocument(file, false); await settle();
  const root = '(editing ? document.querySelector("#editor-content") : document.querySelector("#content"))';
  const metrics = () => run(`(() => { const h=[...${root}.querySelectorAll('h2')].find(h=>h.textContent==='Section 18'); return {top:reader.scrollTop,heading:h.getBoundingClientRect().top-reader.getBoundingClientRect().top,editing}; })()`);
  const clickEdit = async () => {
    const point = await run(`(() => {const r=document.querySelector('[data-quick-action="edit"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await settle();
  };
  await run(`(() => {const h=[...${root}.querySelectorAll('h2')][18];reader.scrollTo({top:reader.scrollTop+h.getBoundingClientRect().top-reader.getBoundingClientRect().top-30,behavior:'instant'})})()`); await settle();
  const before = await metrics(); await clickEdit(); const after = await metrics();
  console.log('MODE SCROLL first native click', JSON.stringify({before,after}));
  assert.equal(after.editing, true);
  assert.ok(Math.abs(after.heading-before.heading)<4, 'native Edit preserves visible heading, not default caret at document start');
  await win.webContents.insertText('EDIT-HERE '); await settle();
  assert.ok((await run('reader.scrollTop')) > 10000, 'first native typing edits the visible location, not a default top caret');
  assert.equal(await run('richEditor.editor.state.selection.$from.parent.textContent.replace("EDIT-HERE ", "")'), 'Section 18');
  await run('richEditor.editor.commands.undo()'); await settle();
  await clickEdit(); const back = await metrics();
  console.log('MODE SCROLL return', JSON.stringify(back));
  assert.ok(Math.abs(back.heading-before.heading)<4, 'read preview preserves visible heading');
  assert.equal(await run('payload().source'), source);
  const toggle = async kind => {
    const expected = !(await run('editing'));
    if (kind === 'button') await clickEdit();
    else if (kind === 'menu') { Menu.getApplicationMenu().getMenuItemById('edit-mode').click(); await settle(); }
    else { win.focus(); win.webContents.focus(); await settle(); assert.equal(win.webContents.isFocused(),true,'native Ctrl+E requires the test renderer focused'); win.webContents.sendInputEvent({type:'keyDown',keyCode:'E',modifiers:['control']}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'E',modifiers:['control']}); await settle(); }
    for (let n=0;n<40 && await run('editing')!==expected;n++) await settle();
    if (await run('editing') !== expected) console.log('KEY FAILURE', {windowFocused:win.isFocused(),webContentsFocused:win.webContents.isFocused()}, await run('({notice:$("#toast").textContent,sourceChanged:payload().source!==currentDocument.source,selection:richEditor.editor.state.selection.toJSON(),active:document.activeElement?.className})'));
    assert.equal(await run('editing'), expected, `${kind} toggles mode`);
  };
  for (const [variant, theme] of ['light','dark','warm','review'].entries()) {
    await run(`$('#theme').value=${JSON.stringify(theme)};applyTheme();fontSize=${13+variant*3};applyFont();document.body.classList.toggle('outline-hidden',${variant%2===1});toolsCollapsed=${variant%2===0};applyToolsPanel()`); await settle();
    for (const [i, kind] of ['button','menu','key'].entries()) {
      const index = [0,18,35][i];
      for (let repeat = 0; repeat < 2; repeat++) {
        await run(`(() => {const h=${root}.querySelectorAll('h2')[${index}];reader.scrollTo({top:reader.scrollTop+h.getBoundingClientRect().top-reader.getBoundingClientRect().top-30,behavior:'instant'})})()`); await settle();
        const position = () => run(`${root}.querySelectorAll('h2')[${index}].getBoundingClientRect().top-reader.getBoundingClientRect().top`);
        const y = await position();
        await toggle(kind); assert.equal(await run('editing'), true, kind);
        assert.ok(Math.abs(await position()-y)<4, `${theme}/${kind}/${repeat}: edit anchor`);
        await toggle(kind); assert.equal(await run('editing'), false, kind);
        assert.ok(Math.abs(await position()-y)<4, `${theme}/${kind}/${repeat}: read anchor`);
      }
    }
  }
  // Each semantic block can be the viewport anchor, not only a heading.
  for (const selector of ['p','li','pre','td','p:has(img)']) {
    await run(`(() => {const node=${root}.querySelectorAll(${JSON.stringify(selector)})[18];reader.scrollTo({top:reader.scrollTop+node.getBoundingClientRect().top-reader.getBoundingClientRect().top-30,behavior:'instant'})})()`); await settle();
    const anchor = await run('captureModeView()'); await clickEdit();
    const edited = await run('captureModeView()');
    assert.equal(edited.key, anchor.key, `${selector}: matching editor block`);
    console.log('MODE BLOCK', selector, JSON.stringify({before:anchor.scrollTop,after:edited.scrollTop,offsetBefore:anchor.offset,offsetAfter:edited.offset}));
    assert.ok(anchor.offset < 0 ? Math.abs(edited.fraction-anchor.fraction)<0.03 : Math.abs(edited.offset-anchor.offset)<4, `${selector}: editor offset`);
    await clickEdit(); const read = await run('captureModeView()');
    assert.equal(read.key, anchor.key, `${selector}: matching reader block`);
    assert.ok(Math.abs(read.offset-anchor.offset)<4, `${selector}: reader offset`);
  }
  assert.equal(await run('payload().source'), source);
  for (const edge of ['top','bottom']) {
    await run(`reader.scrollTo({top:${edge==='top'?'0':'reader.scrollHeight'},behavior:'instant'})`); await settle();
    const y = await run('reader.scrollTop');
    for (let i=0;i<2;i++) { await toggle('button'); await toggle('button'); }
    assert.ok(Math.abs(await run('reader.scrollTop')-y)<4, `${edge} roundtrip`);
  }
  // Local code controls survive reusing the editor; no global scroll suppression.
  await toggle('button');
  await run('window.modeCode=$("#editor-content .code-block");changeCodeZoom(window.modeCode,1);window.modeCode.querySelector(".collapse-code").click();reader.scrollTo({top:5000,behavior:"instant"})'); await settle();
  await toggle('button'); await toggle('button');
  assert.equal(await run('window.modeCode.isConnected && window.modeCode.classList.contains("code-collapsed") && window.modeCode.dataset.codeZoom==="110"'),true);
  await run('window.modeCode.querySelector(".collapse-code").click();changeCodeZoom(window.modeCode,0)');
  await toggle('button');
  // Existing editor identity, a nonempty selection, dirty source and undo survive.
  await toggle('button');
  await run('window.modeEditor=richEditor.editor;richEditor.editor.commands.setTextSelection(10);richEditor.editor.commands.insertContent("DIRTY-SENTINEL");richEditor.editor.commands.setTextSelection({from:2,to:8})');
  const dirty = await run('payload().source'); const selection = await run('richEditor.editor.state.selection.toJSON()');
  await run('reader.scrollTo({top:reader.scrollHeight/2,behavior:"instant"})'); await settle();
  const dirtyY = await run('reader.scrollTop');
  await toggle('button'); await toggle('button');
  assert.equal(await run('richEditor.editor===window.modeEditor'), true);
  assert.deepEqual(await run('richEditor.editor.state.selection.toJSON()'), selection);
  assert.equal(await run('payload().source'), dirty);
  assert.ok(Math.abs(await run('reader.scrollTop')-dirtyY)<4, 'dirty view roundtrip');
  await run('richEditor.editor.commands.undo()'); assert.equal(await run('payload().source'), source);
  await run('richEditor.editor.commands.redo()'); assert.equal(await run('payload().source'), dirty);
  // Independent per-tab editing/reading viewport state.
  const first = await run('currentDocument.id');
  await run('reader.scrollTo({top:5000,behavior:"instant"});rememberWorkspaceView()'); await settle();
  const firstY = await run('reader.scrollTop');
  const secondFile = path.join(dir,'second.md'); fs.writeFileSync(secondFile, source);
  await openDocument(secondFile,false); await settle();
  const second = await run('currentDocument.id');
  await run('reader.scrollTo({top:1700,behavior:"instant"});rememberWorkspaceView()'); await settle();
  for (let i=0;i<2;i++) {
    await run(`switchToTab(${first})`); await settle();
    assert.equal(await run('editing'),true); assert.ok(Math.abs(await run('reader.scrollTop')-firstY)<4, JSON.stringify({firstY, restored:await run('({top:reader.scrollTop,view:currentDocument.viewState,restoringView})')}));
    assert.equal(await run('payload().source'),dirty);
    await run(`switchToTab(${second})`); await settle();
    assert.equal(await run('editing'),false); assert.ok(Math.abs(await run('reader.scrollTop')-1700)<4);
  }
  // Navigation following the toggle must not be undone by a delayed restorer.
  await toggle('button');
  await run('document.querySelector("#outline a:last-child").click()');
  // Smooth scrolling is asynchronous; observe the actual destination instead
  // of assuming the long document settles in 1s, then check it stays there.
  for (let i = 0; i < 200 && !(await run('reader.scrollTop>reader.scrollHeight*.85')); i++) await new Promise(resolve=>setTimeout(resolve,25));
  await settle();
  assert.ok(await run('reader.scrollTop>reader.scrollHeight*.85'), 'outline remains live');
  assert.equal(await run('restoringView'),false);
  for (const mode of ['edit','read']) {
    if (mode==='read') await toggle('button');
    await run('window.mdviewSearch.open();$("#document-search-query").value="Section 12";window.mdviewSearch.refresh()');
    for (let i=0;i<60 && !(await run('window.mdviewSearch.total===1&&!window.mdviewSearch.pending'));i++) await settle();
    assert.equal(await run('window.mdviewSearch.total'),1);
    await run('$("#document-search-next").click()'); await settle();
    const hit = await run(`(() => {const h=[...${root}.querySelectorAll('h2')].find(h=>h.textContent==='Section 12');const r=h.getBoundingClientRect(),b=reader.getBoundingClientRect();return {y:r.top-b.top,height:reader.clientHeight}})()`);
    assert.ok(hit.y>0&&hit.y<hit.height, `${mode}: search navigation remains visible after mode switch`);
    await run('window.mdviewSearch.close()');
  }
  assert.equal(fs.readFileSync(file,'utf8'),source);
  clearTimeout(timer); console.log('MODE SCROLL PASS: native button/menu/CtrlE, repeated top/middle/bottom, mixed blocks, four themes/fonts/panels, native typing, source/history/selection, independent tabs, outline'); app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
