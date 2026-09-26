const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ win, openDocument, app }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-select-'));
  const file = path.join(dir, 'paragraphs.md');
  await fs.writeFile(file, 'First paragraph\n\nSecond paragraph\n\n### Existing heading\n');
  await openDocument(file);
  await run('if (!editing) toggleEditing(); toolsCollapsed = false; applyToolsPanel();');
  assert.equal(await run("!!document.querySelector('#block-type-trigger')"), true, 'paragraph style uses a custom trigger');
  const settle = () => run('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const open = () => run("$('#block-type-trigger').click()");
  const isOpen = () => run("$('#block-type-listbox').matches(':popover-open')");
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});
    win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});
    await settle();
  };
  const mouse = async selector => {
    const point = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
    win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
    await settle();
  };
  await settle();
  await run("window.selectViolations=[]; document.addEventListener('securitypolicyviolation',event=>selectViolations.push(event.violatedDirective));window.styleChanges=0;$('#block-type').addEventListener('change',()=>styleChanges++);richEditor.editor.commands.setTextSelection({from:1,to:6});richEditor.editor.view.focus()");
  await mouse('#block-type-trigger');
  assert.equal(await isOpen(), true, 'menu is in top layer');
  await mouse('#block-type-option-2');
  assert.equal(await run("richEditor.editor.isActive('heading', {level:2})"), true, 'real mouse applies heading');
  assert.deepEqual(await run('({from:richEditor.editor.state.selection.from,to:richEditor.editor.state.selection.to})'), {from:1,to:6}, 'native pointer preserves text range');
  assert.equal(await run('styleChanges'), 1, 'one legacy change event');
  assert.equal(await run("$('#block-type').value"), '2');
  assert.equal(await run("$('#block-type-trigger').textContent"), '标题 2');
  await run('richEditor.editor.commands.undo()');
  assert.equal(await run("$('#block-type-trigger').textContent"), '正文', 'undo sync');
  await run("richEditor.editor.state.doc.descendants((node,pos)=>{if(node.type.name==='heading')richEditor.editor.commands.setTextSelection(pos+1)})");
  assert.equal(await run("$('#block-type-trigger').textContent"), '标题 3', 'caret sync');
  await run("$('#block-type-trigger').focus()");
  await key('Space'); await key('Down');
  assert.equal(await run("$('#block-type-trigger').getAttribute('aria-activedescendant')"), 'block-type-option-4');
  assert.equal(await run("$('#block-type').value"), '3', 'arrows do not apply early');
  await key('Return');
  assert.equal(await run("richEditor.editor.isActive('heading',{level:4})"), true, 'keyboard applies heading');
  await settle(); await open(); await key('Home'); await key('Escape');
  assert.equal(await isOpen(), false);
  assert.equal(await run("$('#block-type').value"), '4', 'Escape cancels');
  assert.equal(await run('document.activeElement.id'), 'block-type-trigger');
  await open(); await key('End'); await key('Tab');
  assert.equal(await isOpen(), false);
  assert.equal(await run("document.activeElement.closest('[data-edit]')?.dataset.edit"), 'toggleBold', 'Tab follows normal order');
  assert.equal(await run("$('#block-type').value"), '4');
  await open(); await key('Tab',['shift']);
  assert.equal(await run('document.activeElement.id'), 'toggle-editor-tools', 'Shift-Tab exits');
  await open(); await mouse('.inspector-section h2');
  assert.equal(await isOpen(), false, 'outside dismissal');
  await open(); await run('fileBusy=true;syncEditorTools()');
  assert.equal(await isOpen(), false, 'busy dismissal');
  assert.equal(await run("$('#block-type-trigger').disabled"), true);
  const before=await run('richEditor.source()');
  await run("$('#block-type-trigger').click();$('#block-type').dispatchEvent(new Event('change'))");
  assert.equal(await run('richEditor.source()'),before,'busy cannot mutate');
  await run('fileBusy=false;syncEditorTools()');
  await open();await run('toolsCollapsed=true;applyToolsPanel()');await settle();
  assert.equal(await isOpen(),false,'collapse dismissal');
  await run('toolsCollapsed=false;applyToolsPanel()');
  const size=win.getSize(), palettes=[];
  win.setSize(800,600);
  try {
    for(const language of ['en','zh-CN']) {
      await run(`applyLanguage(${JSON.stringify(language)})`);await settle();
      for(const theme of ['light','dark','warm']) {
        await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await open();
        const geometry=await run(`(()=>{const menu=$('#block-type-listbox'),m=menu.getBoundingClientRect(),r=$('#block-type-trigger').getBoundingClientRect();return {
          aligned:Math.abs(r.left-m.left)<1&&Math.abs(r.width-m.width)<1,
          bounded:m.left>=0&&m.top>=0&&m.right<=innerWidth&&m.bottom<=innerHeight,
          overflow:menu.scrollWidth>menu.clientWidth,radius:getComputedStyle(menu).borderRadius,
          background:getComputedStyle(menu).backgroundColor,
          selected:menu.querySelector('[aria-selected="true"]').textContent,
          label:$('#block-type-label').textContent,
          check:getComputedStyle(menu.querySelector('[aria-selected="true"] .paragraph-select-check')).visibility,
          hit:menu.contains(document.elementFromPoint(m.left+10,m.top+10))}})()`);
        assert.equal(geometry.aligned,true,'aligned at narrow width');assert.equal(geometry.bounded,true,'bounded');
        assert.equal(geometry.overflow,false);assert.equal(geometry.radius,'10px');assert.equal(geometry.hit,true,'not clipped');
        assert.equal(geometry.check,'visible');
        assert.equal(geometry.selected,language==='en'?'Heading 4✓':'标题 4✓');
        assert.equal(geometry.label,language==='en'?'Paragraph type':'段落类型');
        if(language==='en')palettes.push(geometry.background);
        await settle();
        const image=await new Promise((resolve,reject)=>{
          const timer=setTimeout(()=>{win.webContents.removeListener('paint',paint);reject(new Error('select paint timeout'));},8000);
          const paint=(_event,_dirty,image)=>{if(image.isEmpty())return;clearTimeout(timer);win.webContents.removeListener('paint',paint);resolve(image);};
          win.webContents.on('paint',paint);win.webContents.invalidate();
        });
        const artifacts=path.resolve('artifacts/desktop');await fs.mkdir(artifacts,{recursive:true});
        await fs.writeFile(path.join(artifacts,`paragraph-select-${language}-${theme}.png`),image.toPNG());
        await key('Escape');
      }
    }
    assert.equal(new Set(palettes).size,3);
    await open();await run("$('#editor-panel-body').scrollTop=100");await settle();
    assert.equal(await isOpen(),false,'scroll dismissal');
    assert.deepEqual(await run('selectViolations'),[],'no dropdown CSP violations');
  } finally {
    win.setSize(...size);await run("applyLanguage('zh-CN');applyTheme();$('#editor-panel-body').scrollTop=0");
  }
  console.log('Paragraph selector smoke: native pointer range, headings/undo/caret sync, keyboard, dismissal/busy, bilingual labels, three themes, narrow top-layer geometry, CSP passed');
};
