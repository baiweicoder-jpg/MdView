// Isolated production renderer: never opens the user's profile or documents.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const electron = require('electron');
const {app} = electron;
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-table-overflow-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.disableHardwareAcceleration();
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return {...electron, BrowserWindow: class extends electron.BrowserWindow {
    constructor(options) { super({...options, show:false, webPreferences:{...options.webPreferences, offscreen:true, backgroundThrottling:false}}); }
  }};
  return load.call(this, name, ...args);
};
const watchdog = setTimeout(() => { console.error('table overflow timeout'); app.exit(1); }, 90000);
(async () => {
  const {win, editSession} = await require('../src/main.cjs');
  Module._load = load;
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let n=0; n<200; n++) { if (await run(code)) return; await new Promise(r=>setTimeout(r,20)); } assert.fail(code); };
  const settle = () => run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await wait('!!currentDocument && !restoringView');
  const records = [];
  for (const theme of ['light','dark']) for (const width of [1500,900]) for (const wide of [false,true]) {
    win.setSize(width,800);
    const file = path.join(scratch, `${theme}-${width}-${wide?'wide':'short'}.md`);
    fs.writeFileSync(file, `## Synthetic table\n\n{table-widths=${wide?'600,700':'140,260'}}\n\n| Name | Address |\n| --- | --- |\n| Sample | https://example.invalid/table |\n\n## Following section\n\n${'Synthetic document paragraph.\n\n'.repeat(30)}`);
    editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));
    await wait(`currentDocument?.name===${JSON.stringify(path.basename(file))} && !restoringView`);
    if (!await run('editing')) await run('toggleEditing()');
    await wait('editing && !!richEditor && !restoringView');
    await run(`document.querySelector('#theme').value=${JSON.stringify(theme)};applyTheme();document.querySelector('main').scrollTo({top:0,behavior:'instant'});richEditor.editor.view.dom.querySelector('[data-resize-table]').focus({preventScroll:true});void 0`);
    await settle();
    const metrics = await run(`(()=>{
      const root=richEditor.editor.view.dom,w=root.querySelector('.mdview-table-scroll'),t=root.querySelector('table'),m=document.querySelector('main');
      const box=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:r.x,y:r.y,width:r.width,height:r.height,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,overflowX:s.overflowX,overflowY:s.overflowY};};
      const start=m.scrollTop;m.scrollTo({top:100,behavior:'instant'});const outerScrolls=m.scrollTop>start;m.scrollTo({top:start,behavior:'instant'});
      w.scrollLeft=w.scrollWidth;const horizontalScrolls=w.scrollLeft>0;
      const handle=root.querySelector('[data-resize-table]'),hr=handle.getBoundingClientRect(),wr=w.getBoundingClientRect();
      const widthHandleReachable=hr.left>=wr.left && hr.right<=wr.left+w.clientWidth;w.scrollLeft=0;
      return {wrapper:box(w),table:box(t),canvas:box(root.querySelector('.table-perimeter-canvas')),controls:box(root.querySelector('.table-width-controls')),main:box(m),outerScrolls,horizontalScrolls,widthHandleReachable,controlOpacity:getComputedStyle(root.querySelector('.table-width-controls')).opacity,buttons:[...root.querySelectorAll('.table-width-controls button')].filter(b=>!b.hidden).map(b=>({label:b.getAttribute('aria-label'),...box(b)}))};
    })()`);
    const shot = path.join(scratch, `${theme}-${width}-${wide?'wide':'short'}.png`);
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    records.push({theme,width,wide,shot,...metrics});
    console.log('TABLE OVERFLOW', JSON.stringify({theme,width,wide,wrapper:metrics.wrapper,outerScrolls:metrics.outerScrolls,shot}));
  }
  fs.writeFileSync(path.join(scratch,'metrics.json'),JSON.stringify(records,null,2));
  console.log('EVIDENCE',scratch);
  for (const r of records) {
    assert.equal(r.wrapper.scrollHeight,r.wrapper.clientHeight,`${r.theme}/${r.width}/${r.wide}: table wrapper must not scroll vertically`);
    assert.equal(r.outerScrolls,true,'document vertical scrolling retained');
    assert.equal(r.controlOpacity,'1','focused perimeter controls visible');
    if (r.wide) {
      assert.ok(r.wrapper.scrollWidth>r.wrapper.clientWidth,'wide table retains horizontal overflow');
      assert.equal(r.horizontalScrolls,true,'wide table actually scrolls horizontally');
    }
    assert.equal(r.widthHandleReachable,true,'horizontal scrolling keeps the whole width handle reachable');
    const reset = r.buttons.find(b=>b.label?.includes('Automatic width'));
    assert.ok(reset && reset.scrollHeight<=reset.clientHeight,'reset glyph fits its gutter button');
    assert.ok(r.buttons.some(b=>b.label?.includes('Total table width')),'whole width control retained');
    assert.ok(r.buttons.some(b=>b.label?.includes('Insert row')) && r.buttons.some(b=>b.label?.includes('Insert column')),'insertion rails retained');
  }
  win.destroy(); clearTimeout(watchdog); app.exit(0);
})().catch(error=>{Module._load=load;console.error(error);clearTimeout(watchdog);app.exit(1);});
