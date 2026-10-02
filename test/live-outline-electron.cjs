const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-outline-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => {
  win.setOpacity(0); win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true);
  win.webContents.setBackgroundThrottling(false); win.showInactive();
});
(async () => {
  const { win, editSession } = await require('../src/main.cjs');
  // Disable throttling on the loaded renderer as well as the native window.
  win.webContents.setBackgroundThrottling(false);
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => {
    for (let i = 0; i < 200; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 25)); }
    assert.fail(`renderer did not settle: ${code}`);
  };
  const titles = () => run("[...document.querySelectorAll('#outline a')].map(a=>a.textContent)");
  await wait('!!currentDocument && !restoringView');
  const file = path.join(dir, '资源网站.md');
  fs.writeFileSync(file, '# 资源网站\n\n## 赚钱方式\n');
  editSession.openDocument(await require('../src/markdown.cjs').readDocument(file));
  await wait('currentDocument?.name === "资源网站.md" && !restoringView');
  assert.deepEqual(await titles(), ['资源网站', '赚钱方式'], 'reader includes the actual H1, not metadata title');
  await run('toggleEditing()');
  await run('richEditor.editor.commands.setTextSelection(2); richEditor.editor.view.focus(); window.outlineEditor = richEditor.editor; true');
  await win.webContents.insertText('实时');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(await titles(), ['资实时源网站', '赚钱方式'], 'native typing immediately renames outline');
  assert.equal(await run('richEditor.editor === window.outlineEditor'), true);
  await run('richEditor.editor.commands.undo()');
  assert.deepEqual(await titles(), ['资源网站', '赚钱方式']);
  await run('richEditor.editor.commands.redo()');
  assert.deepEqual(await titles(), ['资实时源网站', '赚钱方式']);
  const hierarchy = '# 重复\n\n## 重复\n\n### 第三\n\n#### 第四\n\n##### 第五\n\n###### 第六\n\n' + '正文\n\n'.repeat(80) + '## 重复\n\n' + '结尾\n\n'.repeat(30);
  await run(`richEditor.editor.commands.setContent(${JSON.stringify(hierarchy)}, {contentType:'markdown'})`);
  assert.deepEqual(await titles(), ['重复', '重复', '第三', '第四', '第五', '第六', '重复']);
  assert.equal(await run('document.querySelector("#heading-count").textContent'), '7');
  assert.deepEqual(await run("[...document.querySelectorAll('#outline a')].map(a=>a.dataset.target)"), ['重复', '重复-2', '第三', '第四', '第五', '第六', '重复-3']);
  assert.equal(await run("new Set([...document.querySelectorAll('#outline a')].slice(0,6).map(a=>a.style.paddingLeft)).size"), 6);
  await run('richEditor.editor.commands.setTextSelection({from:2,to:3}); reader.scrollTo({top:180,behavior:"instant"}); true');
  const stable = await run('({selection:richEditor.editor.state.selection.toJSON(),scroll:reader.scrollTop,source:payload().source})');
  await run('setEditingUI()');
  assert.deepEqual(await run('({selection:richEditor.editor.state.selection.toJSON(),scroll:reader.scrollTop,source:payload().source})'), stable, 'outline refresh preserves selection, source and reader scroll');
  for (const mode of ['edit', 'read']) {
    if (mode === 'read') await run('toggleEditing()');
    await run("reader.scrollTop=0; document.querySelector('#outline a:last-child').click()");
    await wait('reader.scrollTop > 1000');
    assert.equal(await run('editing'), mode === 'edit');
    assert.equal(await run('document.querySelector("#heading-count").textContent'), '7');
  }
  await run('toggleEditing()');
  await new Promise(resolve => setTimeout(resolve, 600)); // Separate the deletion's history group.
  await run("richEditor.editor.commands.setContent('<p>no headings</p>')");
  assert.deepEqual(await titles(), []);
  assert.equal(await run('document.querySelector("#heading-count").textContent'), '0');
  await run('richEditor.editor.commands.undo()');
  assert.equal((await titles()).length, 7, 'undo restores removed hierarchy');
  await run('richEditor.editor.commands.redo()');
  assert.deepEqual(await titles(), [], 'redo removes hierarchy again');
  await run(`richEditor.editor.commands.setContent(${JSON.stringify(hierarchy)}, {contentType:'markdown'})`);
  const first = await run('currentDocument.id');
  await run('window.mdview.newDocument()');
  await wait(`currentDocument.id !== ${first} && editing && !restoringView`);
  const second = await run('currentDocument.id');
  await run("richEditor.editor.commands.setContent('<h1>另一份文档</h1><h6>尾部</h6>')");
  assert.deepEqual(await titles(), ['另一份文档', '尾部']);
  for (let i = 0; i < 3; i++) {
    await run(`switchToTab(${first})`);
    await wait('!restoringView');
    assert.deepEqual(await titles(), ['重复', '重复', '第三', '第四', '第五', '第六', '重复']);
    await run(`switchToTab(${second})`);
    await wait('!restoringView');
    assert.deepEqual(await titles(), ['另一份文档', '尾部']);
  }
  await run(`(async () => {
    const pending = toggleEditing();
    richEditor.editor.commands.insertContent('晚到输入');
    await pending;
  })()`);
  assert.equal(await run('editing'), true, 'typing during pending preview keeps the live draft visible');
  assert.ok((await titles()).some(title => title.includes('晚到输入')));
  await run(`(async () => {
    const pending = toggleEditing();
    processDocument({ok:true, document:{...currentDocument,name:'transition.md',source:'# 新活动文档',html:'<h1 id="new-active">新活动文档</h1>',editorHtml:'<h1>新活动文档</h1>',headings:[{id:'new-active',title:'新活动文档',level:1}],warnings:[],characters:6}});
    await pending;
  })()`);
  assert.deepEqual(await titles(), ['新活动文档'], 'a late preview must not overwrite a newer active document');
  assert.equal(await run('editing'), false);
  await run('toggleEditing()');
  await run('(async () => { const pending = toggleEditing(); processDocument({ok:true,empty:true}); await pending; })()');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(await titles(), []);
  assert.equal(await run('document.querySelector("#heading-count").textContent'), '0');
  assert.equal(await run('observer === null'), true);
  console.log('LIVE OUTLINE PASS: native typing, H1–H6, duplicates/navigation, undo/redo, selection/scroll, mode/tab switches, empty workspace');
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
