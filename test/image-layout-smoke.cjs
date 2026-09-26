const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { renderMarkdown, readDocument, renderEditorHtml } = require('../src/markdown.cjs');
const { saveTextFile } = require('../src/document-file.cjs');

module.exports = async ({ win, outputDirectory }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(r=>setTimeout(r,120))');
  const png = (await win.webContents.capturePage()).resize({ width: 400, height: 200 }).toPNG();
  await fs.writeFile(path.join(outputDirectory, 'row.png'), png);
  const embedded = 'data:image/png;base64,' + png.toString('base64');
  const source = `![local](row.png "kept title"){width=160} ![embedded](${embedded}){width=192}\n\nbefore ![in text](row.png){width=80} after`;
  const mount = async doc => {
    await run(`window.layoutHarness?.destroy();document.querySelector('#image-layout-host')?.remove();
      {const host=document.createElement('div');host.id='image-layout-host';host.className='markdown';host.style.width='600px';host.style.position='fixed';host.style.top='70px';host.style.left='24px';host.style.zIndex='999';host.style.background='var(--surface)';document.body.append(host);
      window.layoutHarness=MdViewRich.create(host,${JSON.stringify(doc)},()=>{}); } void 0;`);
    await settle();
  };
  const sizes = () => run(`Array.from(layoutHarness.editor.view.dom.querySelectorAll('img:not(.ProseMirror-separator)'), i=>i.getBoundingClientRect().width)`);
  const click = index => run(`layoutHarness.editor.view.dom.querySelectorAll('.image-size-increase')[${index}].click()`);
  const wasVisible = win.isVisible();
  win.show(); win.focus();
  try {
    await mount({ source, ...await renderMarkdown(source, outputDirectory) });
    assert.equal(await run("(()=>{const nodes=[];layoutHarness.editor.state.doc.descendants(n=>{if(n.type.name==='image') nodes.push(n.isInline)});return nodes.length===3 && nodes.every(Boolean)})()"), true, 'images remain inline rather than splitting paragraphs');
    assert.deepEqual(await sizes(), [160,192,80]);
    assert.equal(await run("layoutHarness.editor.getText().includes('before  after')"), true);
    // Real Chromium pointer input selects the image and exposes its controls.
    const point = await run(`(()=>{const r=layoutHarness.editor.view.dom.querySelector('.editor-image img').getBoundingClientRect();return {x:Math.round(r.x+100),y:Math.round(r.y+40)}})()`);
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await settle();
    assert.equal(await run("layoutHarness.editor.state.selection.node?.type.name"), 'image');
    assert.equal(await run("getComputedStyle(layoutHarness.editor.view.dom.querySelector('.image-size-controls')).opacity"), '1');
    await run(`window.imageLayoutViolations=[];window.imageLayoutCsp=e=>imageLayoutViolations.push(e.violatedDirective);document.addEventListener('securitypolicyviolation',imageLayoutCsp)`);
    assert.equal(await run("layoutHarness.editor.view.dom.querySelectorAll('.editor-image.ProseMirror-selectednode .image-resize-handle').length"), 8, 'selected image exposes edge and corner handles');
    const startDrag = async (direction = 'e', index = 0) => {
      await run(`{let positions=[];layoutHarness.editor.state.doc.descendants((n,p)=>{if(n.type.name==='image')positions.push(p)});layoutHarness.editor.commands.setNodeSelection(positions[${index}]);}`);
      await settle();
      const point = await run(`(()=>{const h=layoutHarness.editor.view.dom.querySelectorAll('.editor-image')[${index}].querySelector('.image-resize-${direction}');window.activeImageHandle=h;const r=h.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      win.webContents.sendInputEvent({type:'mouseMove',...point});
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      await settle();
      assert.equal(await run("layoutHarness.editor.view.dom.classList.contains('image-resizing')"), true, 'real pointer starts resize');
      return point;
    };
    const moveDrag = async (point, dx, dy = 0) => {
      const end = {x:point.x+dx,y:point.y+dy};
      win.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],...end});
      await settle();
      return end;
    };
    const endDrag = async point => {
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      await settle();
    };
    const originalSource = await run('layoutHarness.source()');
    for (const [direction, dx, dy] of [['e',32,0],['w',-32,0],['n',0,-16],['s',0,16],['ne',32,-16],['nw',-32,-16],['se',32,16],['sw',-32,16]]) {
      const start = await startDrag(direction);
      const end = await moveDrag(start,dx,dy);
      assert.equal(await run("activeImageHandle.hasPointerCapture(1)"),true, 'drag retains real pointer capture');
      assert.deepEqual(await sizes(), [192,192,80], direction+' live aspect-preserving preview');
      assert.equal(await run('layoutHarness.source()'), originalSource, 'preview does not dirty source');
      assert.equal(await run("getComputedStyle(layoutHarness.editor.view.dom).userSelect"), 'none');
      assert.equal(await run("window.getSelection().toString()"), '', 'pointer movement never selects neighboring text');
      assert.equal(await run("layoutHarness.editor.state.selection.node?.type.name"), 'image');
      assert.equal(await run("(()=>{const r=layoutHarness.editor.view.dom.querySelector('.editor-image img').getBoundingClientRect();return r.width/r.height})()"), 2);
      await endDrag(end);
      assert.equal(await run('layoutHarness.editor.state.doc.firstChild.firstChild.attrs.width'),192);
      assert.match(await run('layoutHarness.source()'), /row.png "kept title"\)\{width=192\}/);
      assert.equal(await run("layoutHarness.editor.view.dom.classList.contains('image-resizing')"),false);
      await run('layoutHarness.editor.commands.undo()'); await settle();
      assert.deepEqual(await sizes(),[160,192,80], 'one undo reverts entire '+direction+' drag');
    }
    // Multiple pointer moves still create one isolated undo entry; save the actual drag result.
    let start = await startDrag();
    await moveDrag(start,16); await moveDrag(start,48);
    await endDrag(await moveDrag(start,64));
    const dragFile = path.join(outputDirectory,'image-drag.md');
    await saveTextFile(dragFile,await run('layoutHarness.source()'),{expectedHash:null});
    const dragDoc = await readDocument(dragFile);
    assert.match(dragDoc.source,/row.png "kept title"\)\{width=224\}/);
    await run('layoutHarness.editor.commands.undo()'); await settle();
    assert.deepEqual(await sizes(),[160,192,80]);
    // Cancellation paths use real capture; only OS interruption is dispatched explicitly.
    for (const cancel of ['pointercancel','lostcapture','escape','blur','readonly','selection']) {
      start = await startDrag();
      const end = await moveDrag(start,64);
      if (cancel === 'pointercancel') await run("activeImageHandle.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))");
      if (cancel === 'lostcapture') { await run('activeImageHandle.releasePointerCapture(1)'); await moveDrag(start,65); }
      if (cancel === 'escape') { win.webContents.sendInputEvent({type:'keyDown',keyCode:'ESC'}); win.webContents.sendInputEvent({type:'keyUp',keyCode:'ESC'}); }
      if (cancel === 'blur') await run("window.dispatchEvent(new Event('blur'))");
      if (cancel === 'readonly') await run('layoutHarness.editor.setEditable(false)');
      if (cancel === 'selection') await run('layoutHarness.editor.commands.setTextSelection(1)');
      await settle();
      assert.deepEqual(await sizes(),[160,192,80],cancel+' rolls preview back');
      assert.equal(await run("layoutHarness.editor.view.dom.classList.contains('image-resizing')"),false,cancel+' cleans drag state');
      assert.equal(await run('layoutHarness.source()'),originalSource,cancel+' preserves source');
      await endDrag(end);
      await run('layoutHarness.editor.setEditable(true)');
    }
    for (const [delta,width] of [[-800,32],[2000,1600]]) {
      start = await startDrag();
      await endDrag(await moveDrag(start,delta));
      assert.equal(await run('layoutHarness.editor.state.doc.firstChild.firstChild.attrs.width'),width,'drag clamps preferred width');
      await run('layoutHarness.editor.commands.undo()'); await settle();
    }
    await run('layoutHarness.editor.setEditable(false)'); await settle();
    assert.equal(await run("[...layoutHarness.editor.view.dom.querySelectorAll('.image-resize-handle,.image-size-controls')].some(e=>e.checkVisibility())"),false,'read-only has no resize UI');
    await run('layoutHarness.editor.setEditable(true)');
    await run('layoutHarness.editor.setEditable(false, false)'); await settle();
    assert.equal(await run("[...layoutHarness.editor.view.dom.querySelectorAll('.image-resize-handle,.image-size-controls')].some(e=>e.checkVisibility())"),false,'silent read-only transition also hides resize UI');
    await run('layoutHarness.editor.setEditable(true)');
    await run('layoutHarness.editor.commands.setTextSelection(1)'); await settle();
    assert.equal(await run("[...layoutHarness.editor.view.dom.querySelectorAll('.image-resize-handle')].some(e=>e.checkVisibility())"),false,'text selection has no resize handles');
    start = await startDrag(); await endDrag(start);
    assert.equal(await run('layoutHarness.source()'),originalSource,'click without movement does not write a preferred width');
    await click(0); await settle();
    assert.deepEqual(await sizes(), [192,192,80], 'increase affects only selected image');
    assert.match(await run('layoutHarness.source()'), /row.png "kept title"\)\{width=192\}/);
    await run('layoutHarness.editor.commands.undo()'); await settle();
    assert.deepEqual(await sizes(), [160,192,80], 'one undo restores width');
    await run('layoutHarness.editor.commands.redo()');
    await click(1); await settle();
    assert.deepEqual(await sizes(), [192,224,80]);
    await run('layoutHarness.editor.commands.undo()'); await settle();
    assert.deepEqual(await sizes(), [192,192,80], 'independent resize steps do not merge history');
    await run('layoutHarness.editor.commands.redo()');
    // Literal suffix text must not be reinterpreted on the next save.
    await run(`layoutHarness.editor.commands.insertContentAt(layoutHarness.editor.state.doc.content.size-1,{type:'text',text:' {width=240}'});`);
    assert.deepEqual(await run('imageLayoutViolations'), [], 'resizing and undo introduce no CSP violations');
    await run("document.removeEventListener('securitypolicyviolation',imageLayoutCsp)");
    const file = path.join(outputDirectory, 'image-layout.md');
    await saveTextFile(file, await run('layoutHarness.source()'), { expectedHash: null });
    const doc = await readDocument(file);
    assert.equal(await fs.readFile(file,'utf8'), doc.source);
    assert.match(doc.source, /!\[local\]\(row.png "kept title"\)\{width=192\}/);
    await mount(doc);
    assert.deepEqual(await sizes(), [192,224,80], 'disk save/reopen retains independent widths');
    assert.match(await run('layoutHarness.editor.getText()'), /before  after \{width=240\}/);
    await run(`{const reader=document.createElement('div');reader.id='image-row-reader';reader.className='markdown';reader.style.width='600px';reader.innerHTML=${JSON.stringify(doc.html)};document.body.append(reader);}`);
    await settle();
    const geometry = selector => run(`{const host=document.querySelector(${JSON.stringify(selector)});const images=[...host.querySelectorAll('img:not(.ProseMirror-separator)')].map(i=>{const r=i.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,right:r.right};});({images,right:host.getBoundingClientRect().right});}`);
    for (const selector of ['#image-layout-host', '#image-row-reader']) {
      const wide = await geometry(selector);
      assert.equal(wide.images[0].y, wide.images[1].y, selector + ' shares one row');
      assert.ok(wide.images[1].x > wide.images[0].x);
      await run(`document.querySelector(${JSON.stringify(selector)}).style.width='260px'`); await settle();
      const narrow = await geometry(selector);
      assert.ok(narrow.images[1].y > narrow.images[0].y, selector + ' wraps at narrow width');
      assert.ok(narrow.images.every(i=>i.right<=narrow.right+1), selector + ' has no image overflow');
    }
    await run(`for(let i=0;i<60;i++) layoutHarness.editor.view.dom.querySelector('.image-size-increase').click()`);
    assert.equal(await run('layoutHarness.editor.state.doc.firstChild.firstChild.attrs.width'),1600);
    assert.ok((await sizes())[0] <= 260, 'large preferred width clamps to available space');
    await run(`for(let i=0;i<60;i++) layoutHarness.editor.view.dom.querySelector('.image-size-decrease').click()`);
    assert.equal(await run('layoutHarness.editor.state.doc.firstChild.firstChild.attrs.width'),32);
    await run(`layoutHarness.editor.view.dom.querySelector('.image-size-reset').click()`);
    assert.equal(await run('layoutHarness.editor.state.doc.firstChild.firstChild.attrs.width'),null);
    await mount({source:doc.source,editorHtml:renderEditorHtml(doc.source),assets:doc.assets});
    assert.deepEqual(await sizes(), [192,224,80], 'draft reconstruction uses same width syntax');
    await fs.writeFile(path.join(outputDirectory,'image-layout.png'), (await win.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(outputDirectory,'空 格 (a).png'), png);
    const complex = 'left ![a\\]b](<空 格 (a).png> "title & (quoted)"){width=128}{width\\=240} right';
    await mount({source:complex,...await renderMarkdown(complex,outputDirectory)});
    const originalAttrs = await run('layoutHarness.editor.state.doc.firstChild.child(1).attrs');
    for (let pass=0;pass<2;pass++) {
      await click(0);
      const next = path.join(outputDirectory,`image-escaped-${pass}.md`);
      await saveTextFile(next,await run('layoutHarness.source()'),{expectedHash:null});
      await mount(await readDocument(next));
      const attrs = await run('layoutHarness.editor.state.doc.firstChild.child(1).attrs');
      for(const key of ['src','alt','title']) assert.equal(attrs[key],originalAttrs[key], 'escaped '+key+' survives repeated save');
      assert.equal(await run('layoutHarness.editor.getText()'),'left {width=240} right');
    }
    await mount(dragDoc);
    assert.deepEqual(await sizes(),[224,192,80],'drag widths reopen in actual editor');
    start = await startDrag('se',1);
    const secondEnd = await moveDrag(start,32,16);
    assert.deepEqual(await sizes(),[224,224,80],'second image previews independently');
    assert.equal(await run('activeImageHandle.hasPointerCapture(1)'),true);
    await endDrag(secondEnd);
    assert.deepEqual(await sizes(),[224,224,80],'dragging second image leaves first and inline text image unchanged');
    await run('layoutHarness.editor.commands.undo()'); await settle();
    assert.deepEqual(await sizes(),[224,192,80]);
    start = await startDrag();
    await moveDrag(start,32);
    await run('window.oldImageEditor=layoutHarness.editor.view.dom;layoutHarness.destroy()');
    assert.equal(await run("oldImageEditor.classList.contains('image-resizing')"),false,'destroy during capture removes selection lock');
    await endDrag(start);
    await mount(dragDoc);
    assert.deepEqual(await sizes(),[224,192,80],'fresh editor unaffected by destroyed drag');
    console.log('Image layout smoke: eight real edge/corner drags, aspect ratio, capture, no text selection, preview/source isolation, one-step undo, cancel/lostcapture/Escape/blur/read-only/selection/destroy cleanup, 32–1600 bounds, drag disk reopen, inline rows and +/-/reset passed');
  } finally {
    if (!wasVisible) win.hide();
    await run("window.layoutHarness?.destroy();document.querySelector('#image-layout-host')?.remove();document.querySelector('#image-row-reader')?.remove()");
  }
};
