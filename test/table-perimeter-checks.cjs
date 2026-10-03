const assert = require('node:assert/strict');
module.exports = async ({run,win,reset,scratch,fs,path}) => {
  win.show(); win.focus();
  const html='<p>Project plan</p><table><tr><th>Task</th><th>Owner</th><th>Status</th></tr><tr><td>Design</td><td>Lin</td><td>Review</td></tr><tr><td>Build</td><td>Chen</td><td>In progress</td></tr></table><p>Notes</p>';
  const delay=()=>new Promise(r=>setTimeout(r,60));
  const settle=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const point=async selector=>{await settle();return run(`(()=>{const el=e.view.dom.querySelector(${JSON.stringify(selector)});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);};
  const click=async selector=>{const p=await point(selector);win.webContents.sendInputEvent({type:'mouseMove',...p});win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1});await delay();};
  for(const axis of ['row','column']) for(let i=0;i<=3;i++) {
    await reset(html);await settle();const before=await run('e.getJSON()');
    await click(`[data-insert-${axis}="${i}"]`);
    const rows=await run('Array.from(e.view.dom.querySelectorAll("tr"),r=>Array.from(r.cells,c=>c.textContent))');
    assert.equal(rows.length,axis==='row'?4:3,`native ${axis} boundary ${i}`);
    assert.equal(rows[0].length,axis==='column'?4:3);
    assert.ok(axis==='row'?rows[i].every(x=>x===''):rows.every(r=>r[i]===''),`exact insertion boundary ${i}`);
    assert.equal(await run('e.view.dom.querySelectorAll("th").length'),axis==='column'?4:3,'one header');
    const after=await run('e.getJSON()'),source=await run('fixture.source()');
    assert.equal(await run('e.state.selection.$from.node(-1).type.spec.tableRole'),i===0&&axis==='row'?'header_cell':axis==='column'?'header_cell':'cell','caret in inserted cell');
    await run('e.commands.undo()');assert.deepEqual(await run('e.getJSON()'),before,'one undo');
    await run('e.commands.redo()');assert.deepEqual(await run('e.getJSON()'),after,'one redo');
    const disk=path.join(scratch,'perimeter.md');fs.writeFileSync(disk,source);
    await reset(require('../src/markdown.cjs').renderEditorHtml(fs.readFileSync(disk,'utf8')));
    assert.equal(await run('e.getMarkdown()'),source,'source/disk roundtrip');
  }
  await reset(html);await settle();
  await run('document.activeElement.blur()');win.webContents.sendInputEvent({type:'mouseMove',x:1,y:1});await settle();
  assert.equal(await run('getComputedStyle(e.view.dom.querySelector(".table-width-controls")).opacity'),'0','idle is unobtrusive');
  await run('e.view.dom.querySelector("[data-insert-column=\\"1\\"]").focus()');await settle();
  assert.equal(await run('getComputedStyle(e.view.dom.querySelector(".table-width-controls")).opacity'),'1','keyboard focus reveals controls');

  assert.equal(await run('!!document.querySelector(".table-perimeter-tooltip")'),true,'tooltip escapes scrolling table clipping');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
  win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await delay();
  assert.equal(await run('e.view.dom.querySelector("tr").cells.length'),4,'native keyboard activates insertion');
  await run('e.commands.undo()');await settle();
  const p=await point('[data-insert-row="1"]');win.webContents.sendInputEvent({type:'mouseMove',...p});await settle();
  assert.equal(await run('getComputedStyle(e.view.dom.querySelector("[data-insert-row=\\"1\\"]"),"::before").height'),'2px');
  // Geometry lives with the table: horizontal scrolling and CSS/global zoom cannot detach it.
  await reset(require('../src/markdown.cjs').renderEditorHtml('{table-widths=240,240,240}\n\n| Task | Owner | Status |\n| --- | --- | --- |\n| Design | Lin | Review |\n| Build | Chen | In progress |'));
  await run('document.querySelector("#editor").style.width="380px";document.querySelector("#editor").style.zoom="1.25"');await settle();
  await run('e.view.dom.querySelector(".mdview-table-scroll").scrollLeft=190');await settle();
  assert.ok(await run(`(()=>{const a=e.view.dom.querySelector('[data-insert-column="1"]').getBoundingClientRect(),b=e.view.dom.querySelector('th').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.right)<2})()`),'scroll/zoom column boundary stays anchored');
  await run('document.querySelector("#editor").style.zoom="";document.querySelector("#editor").style.width=""');
  await run(`window.port=document.createElement('div');port.style.height='200px';port.style.overflow='auto';const spacer=document.createElement('div');spacer.style.height='150px';document.body.append(port);port.append(spacer,document.querySelector('#editor'));port.scrollTop=130`);await settle();
  win.webContents.setZoomFactor(1.25);await settle();
  assert.ok(await run(`(()=>{const a=e.view.dom.querySelector('[data-insert-row="1"]').getBoundingClientRect(),b=e.view.dom.querySelector('tr').getBoundingClientRect();return Math.abs(a.y+a.height/2-b.bottom)<2&&port.scrollTop>0})()`),'page scroll and global zoom retain row boundary geometry');
  win.webContents.setZoomFactor(1);
  await run(`document.body.append(document.querySelector('#editor'));port.remove()`);await settle();
  win.show();win.focus();win.webContents.focus();await settle();
  assert.equal(win.isFocused() && win.webContents.isFocused(),true,'native drag fixture is focused');
  assert.equal(await run('document.hasFocus()'),true,'native document focus');
  // Native drag cancellation paths preserve source and history.
  const geometry = () => run('Array.from(e.view.dom.querySelector("tr").cells,c=>c.getBoundingClientRect().width)');
  for(const kind of ['pointercancel','lostpointercapture']) {
    await reset(html);await settle();
    const before=await run('fixture.source()'), beforeModel=await run('e.getJSON()'), beforeHistory=await run('fixtureHistory()'), beforeWidths=await geometry();
    const p=await point('[data-resize-column="0"]');
    await run('window.pid=null;document.addEventListener("pointerdown",e=>window.pid=e.pointerId,{once:true,capture:true})');
    win.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});await delay();
    win.webContents.sendInputEvent({type:'mouseMove',x:p.x+35,y:p.y,button:'left',modifiers:['leftButtonDown']});await delay();await settle();
    assert.equal(await run('!!e.view.dom.querySelector(".table-resizing")'),true,kind+' starts a real drag');
    assert.equal(await run('e.view.dom.querySelector("[data-resize-column=\\"0\\"]").hasPointerCapture(pid)'),true,kind+' has native pointer capture');
    assert.ok((await geometry())[0]>beforeWidths[0]+25,kind+' changes preview width before cancellation');
    assert.equal(await run('fixture.source()'),before,kind+' preview does not commit source');
    assert.deepEqual(await run('fixtureHistory()'),beforeHistory,kind+' preview does not enter history');
    if(kind==='lostpointercapture') await run('e.view.dom.querySelector("[data-resize-column=\\"0\\"]").releasePointerCapture(pid)');
    else await run(`e.view.dom.querySelector('[data-resize-column="0"]').dispatchEvent(new PointerEvent('${kind}',{pointerId:pid,bubbles:true}))`);
    // Flush pending native lostpointercapture before release, rather than commit via pointerup.
    win.webContents.sendInputEvent({type:'mouseMove',x:p.x+35,y:p.y,button:'left',modifiers:['leftButtonDown']});await delay();
    assert.equal(await run('!!e.view.dom.querySelector(".table-resizing")'),false,kind+' cancels before pointerup');
    win.webContents.sendInputEvent({type:'mouseUp',x:p.x+35,y:p.y,button:'left',clickCount:1});await delay();await settle();
    assert.equal(await run('fixture.source()'),before,kind+' cancels preview');
    assert.deepEqual(await run('e.getJSON()'),beforeModel,kind+' restores model widths');
    assert.deepEqual(await geometry(),beforeWidths,kind+' restores rendered widths');
    assert.deepEqual(await run('fixtureHistory()'),beforeHistory,kind+' preserves undo and redo history');
    assert.equal(await run('!!e.view.dom.querySelector(".table-resizing")'),false);
  }
  await reset(html);
  await run('document.querySelector("#editor").style.zoom="1.25"');await settle();
  const base=await run('Array.from(e.view.dom.querySelector("tr").cells,c=>Math.round(c.getBoundingClientRect().width/1.25))');
  const start=await point('[data-resize-column="0"]');
  win.webContents.sendInputEvent({type:'mouseMove',...start});await settle();


  win.webContents.sendInputEvent({type:'mouseDown',...start,button:'left',clickCount:1});await delay();
  win.webContents.sendInputEvent({type:'mouseMove',x:start.x+50,y:start.y,button:'left',modifiers:['leftButtonDown']});await delay();
  win.webContents.sendInputEvent({type:'mouseUp',x:start.x+50,y:start.y,button:'left',clickCount:1});await delay();

  const widths=await run('e.getJSON().content.find(n=>n.type==="table").content[0].content.map(c=>c.attrs.colwidth?.[0])');
  assert.ok(Math.abs(widths[0]-base[0]-40)<=1&&widths.slice(1).every((w,i)=>Math.abs(w-base[i+1])<=1),'auto-width drag uses logical pixels at zoom');
  await run('document.querySelector("#editor").style.zoom=""');
  win.showInactive();
  const shots=[];
  const viewports=[];
  for(const theme of ['light','dark','sky']) for(const width of [900,500]) {
    win.setSize(width,700);await reset(html);await run(`document.documentElement.dataset.theme='${theme}'`);await settle();
    const p=await point(width===900?'[data-insert-column="1"]':'[data-insert-row="1"]');win.webContents.sendInputEvent({type:'mouseMove',...p});await settle();
    win.focus();
    await run(`e.view.dom.querySelector('${width===900?'[data-insert-column="1"]':'[data-insert-row="1"]'}').focus()`);await settle();
    assert.equal(await run('!!document.querySelector(".table-perimeter-tooltip")'),true,'visible tooltip in screenshot');
    const tooltipGeometry = await run(`(()=>{const t=e.view.dom.querySelector('table').getBoundingClientRect(),p=document.querySelector('.table-perimeter-tooltip').getBoundingClientRect();return {clear:p.bottom<=t.top||p.right<=t.left||p.left>=t.right||p.top>=t.bottom,bounded:p.left>=4&&p.right<=innerWidth-4&&p.top>=4&&p.bottom<=innerHeight-4}})()`);
    assert.equal(tooltipGeometry.clear,true,'perimeter tooltip stays outside visible table content');
    assert.equal(tooltipGeometry.bounded,true,'perimeter tooltip remains inside viewport');
    viewports.push(await run(`({theme:'${theme}',width:innerWidth,height:innerHeight})`));
    const shot=path.join(scratch,`perimeter-${theme}-${width}.png`);fs.writeFileSync(shot,(await win.webContents.capturePage()).toPNG());shots.push(shot);
  }
  console.log('PERIMETER PASS: all native row/column boundaries, selection/header, atomic undo/redo/source disk roundtrip, idle/focus, zoom/scroll anchoring, cancellation; screenshots',JSON.stringify(shots));
  console.log('VIEWPORTS',JSON.stringify(viewports));
  win.setSize(900,700);win.focus();win.webContents.focus();
};
