// Real main/preload/renderer, isolated profile; never focuses native input.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-heading-numbering-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0); win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
  win.webContents.setBackgroundThrottling(false); win.showInactive();
});
(async () => {
  const { win, editSession } = await require('../src/main.cjs');
  const run = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch(error) { console.error('Failed renderer probe:',code); throw error; } };
  const wait = async code => {
    for (let i=0;i<150;i++) { if (await run(code)) return; await new Promise(r=>setTimeout(r,20)); }
    assert.fail('renderer did not settle: '+code);
  };
  await wait('!!currentDocument && !restoringView');
  assert.equal(await run('!!document.querySelector("#heading-numbering-enabled")'), true, 'production numbering preference is installed');
  assert.equal(await run('document.querySelector("#heading-numbering-enabled").checked'), false);
  const file = path.join(dir, 'numbering.md');
  const source = '# 资源网站\n\n## 重复\n\n## 重复\n\n### 子项\n\n#### 四\n\n##### 五\n\n###### 六\n\n# 二、赚钱方式\n\n## 1. 手写\n\n## 2026 年报\n\n```md\n# Not a heading\n1. code\n```\n\n1. list\n';
  fs.writeFileSync(file, source);
  editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));
  await wait('currentDocument?.name === "numbering.md" && !restoringView');
  const toggle = value => run(`document.querySelector('#heading-numbering-enabled').checked=${value}; document.querySelector('#heading-numbering-enabled').dispatchEvent(new Event('change'));`);
  const prefixes = root => run(`[...document.querySelectorAll('${root} ${root === '#outline' ? 'a' : ':is(h1,h2,h3,h4,h5,h6)'}')].map(e=>getComputedStyle(e,'::before').content)`);
  const expected = ['"一、"','"1. "','"2. "','"2.1 "','"2.1.1 "','"2.1.1.1 "','"2.1.1.1.1 "','none','none','"2. "'];
  await toggle(true);
  await wait('getComputedStyle(document.querySelector("#content h1"),"::before").content.includes("一、")');
  assert.deepEqual(await prefixes('#content'),expected);
  assert.deepEqual(await prefixes('#outline'),expected);
  assert.equal(await run('payload().source'),source);
  assert.equal(await run('payload().source !== currentDocument.source'),false);
  const anchors = await run('[...document.querySelectorAll("#outline a")].map(a=>a.dataset.target)');
  assert.notEqual(anchors[1],anchors[2]);
  await run('toggleEditing()');
  await wait('editing && !restoringView');
  await wait('getComputedStyle(document.querySelector("#editor-content h1"),"::before").content.includes("一、")');
  await run('window.numberBefore={html:document.querySelector("#editor-content").innerHTML,json:JSON.stringify(richEditor.editor.getJSON()),source:payload().source,selection:JSON.stringify(richEditor.editor.state.selection.toJSON()),undo:richEditor.editor.can().undo()}; window.numberUpdates=0; richEditor.editor.on("update",()=>numberUpdates++); window.numberCsp=[]; document.addEventListener("securitypolicyviolation",e=>numberCsp.push(e.violatedDirective));');
  await toggle(false); await toggle(true);
  await new Promise(r=>setTimeout(r,80));
  assert.deepEqual(await run('({html:document.querySelector("#editor-content").innerHTML,json:JSON.stringify(richEditor.editor.getJSON()),source:payload().source,selection:JSON.stringify(richEditor.editor.state.selection.toJSON()),undo:richEditor.editor.can().undo()})'), await run('numberBefore'));
  assert.equal(await run('numberUpdates'),0); assert.equal(await run('payload().source !== currentDocument.source'),false);
  assert.deepEqual(await prefixes('#editor-content'),expected);
  assert.deepEqual(await prefixes('#outline'),expected);
  // A genuine transaction followed by undo; all CSS remains outside model/history.
  await run('richEditor.editor.commands.insertContentAt(0, {type:"heading",attrs:{level:1},content:[{type:"text",text:"插入"}]})');
  await wait('document.querySelectorAll("#outline a").length === 11');
  assert.equal((await prefixes('#editor-content'))[1],'"二、"');
  assert.deepEqual(await prefixes('#outline'),await prefixes('#editor-content'));
  await run('richEditor.editor.commands.undo()');
  await wait('document.querySelectorAll("#outline a").length === 10');
  assert.equal(await run('payload().source'),source);
  assert.deepEqual(await prefixes('#outline'),expected);
  // Level changes and reorder exercise structural rather than text-only updates.
  await run('richEditor.editor.commands.setTextSelection(2); richEditor.editor.commands.setHeading({level:2})');
  await wait('document.querySelector("#editor-content h2")?.textContent === "资源网站"');
  assert.equal((await prefixes('#editor-content'))[0],'"1. "');
  await run('richEditor.editor.commands.undo()');
  await run('window.originalNumberDoc=richEditor.editor.getJSON(); const d=richEditor.editor.getJSON(); [d.content[0],d.content[1]]=[d.content[1],d.content[0]]; richEditor.editor.commands.setContent(d);');
  await wait('document.querySelector("#editor-content h2")?.textContent === "重复"');
  assert.deepEqual(await prefixes('#outline'),await prefixes('#editor-content'));
  await run('richEditor.editor.commands.setContent(originalNumberDoc)');
  // Search uses real text nodes/ranges, unaffected by pseudo prefixes.
  await run('const h=document.querySelector("#editor-content h2"); const r=document.createRange(); r.selectNodeContents(h); window.numberRange=r; CSS.highlights.set("number-probe",new Highlight(r));');
  assert.equal(await run('numberRange.toString()'),'重复');
  await toggle(false); await toggle(true);
  assert.equal(await run('numberRange.toString()'),'重复');
  assert.equal(await run('CSS.highlights.get("number-probe").size'),1);
  assert.deepEqual(await run('numberCsp'),[]);
  win.setMinimumSize(320,300); win.setContentSize(400,680);
  await wait('innerWidth <= 400');
  await run('document.querySelector("#settings-dialog").showModal()');
  for (const theme of ['light','dark','warm']) {
    await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)};`);
    assert.deepEqual(await prefixes('#editor-content'),expected);
    for (const locale of ['en','zh-CN']) {
      await run(`window.mdview.setLanguage(${JSON.stringify(locale)})`);
      await wait(`document.querySelector('#heading-numbering-settings').textContent.includes(${JSON.stringify(locale==='en'?'Automatic heading numbers':'标题自动序号')})`);
      await run('document.querySelector("#heading-numbering-enabled").scrollIntoView({block:"center"})');
      assert.equal(await run('(()=>{const c=document.querySelector("#heading-numbering-enabled"),r=c.getBoundingClientRect();const d=document.querySelector("#settings-dialog");return c.labels.length===1 && !!c.getAttribute("aria-describedby") && r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && d.scrollWidth<=d.clientWidth;})()'),true,'accessible compact toggle within narrow settings viewport');
    }
  }
  await run('document.querySelector("#settings-dialog").close()');
  await run('toggleEditing()');
  await wait('!editing && !restoringView');
  assert.deepEqual(await prefixes('#content'),expected);
  assert.deepEqual(await prefixes('#outline'),expected);
  await run('document.querySelectorAll("#outline a")[2].click()');
  assert.deepEqual(await run('[...document.querySelectorAll("#outline a")].map(a=>a.dataset.target)'),anchors);
  assert.equal(fs.readFileSync(file,'utf8'),source);
  const frontmatterFile = path.join(dir,'frontmatter.md');
  const frontmatter = '---\ntitle: preserved\n---\n\n# Body\n';
  fs.writeFileSync(frontmatterFile,frontmatter);
  editSession.openDocument(await require('../src/markdown.cjs').readDocument(frontmatterFile));
  await wait('currentDocument?.name === "frontmatter.md" && !restoringView');
  await run('toggleEditing()'); await wait('editing && !restoringView');
  await toggle(false); await toggle(true);
  assert.equal(await run('payload().source'),frontmatter);
  await run('window.mdview.save(payload())');
  assert.equal(fs.readFileSync(frontmatterFile,'utf8'),frontmatter,'real save preserves frontmatter and does not export prefixes');
  // Clean document reload needs no dirty-confirm bypass.
  assert.equal(await run('payload().source !== currentDocument.source'),false);
  const loaded = new Promise(resolve=>win.webContents.once('did-finish-load',resolve));
  win.webContents.reload(); await loaded;
  await wait('document.querySelector("#heading-numbering-enabled")?.checked === true');
  await toggle(false);
  assert.equal(await run('localStorage.getItem("mdview-heading-numbering")'),'false');
  console.log('HEADING NUMBERING PASS: production/default-off, reader/editor/outline, pure DOM/model/source/history/dirty, edits/undo/levels/reorder, duplicate slugs, Range highlights, locales/themes, persistence, unchanged disk');
  app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
