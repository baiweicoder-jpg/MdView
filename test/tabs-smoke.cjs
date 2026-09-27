const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ win, openDocument, app }) => {
  require('./unsaved-driver.cjs')(win);
  const run = code => win.webContents.executeJavaScript(code, true);
  const waitFor = async (code, message) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await run(code)) return;
      await delay(50);
    }
    throw new Error(`Timed out: ${message || code}`);
  };
  const tabState = () => run(`[...document.querySelectorAll('#tab-bar .tab')].map(t => ({ id: +t.dataset.id, name: t.querySelector('.tab-name').textContent, active: t.getAttribute('aria-selected') === 'true', dirty: t.classList.contains('dirty') }))`);

  // 归一化到干净阅读状态：退出编辑模式。
  await run("if (editing) toggleEditing()");
  const baseline = await tabState();
  const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'mdview-tabs-'));
  const fileA = path.join(dir, 'a.md');
  const fileB = path.join(dir, 'b.md');
  await fs.writeFile(fileA, '# Alpha\n\ncontent A');
  await fs.writeFile(fileB, '# Beta\n\ncontent B');

  // 打开新文件 → 追加标签并激活。
  await openDocument(fileA);
  await waitFor("document.querySelector('#file-name').textContent === 'a.md'");
  let tabs = await tabState();
  assert.equal(tabs.length, baseline.length + 1, 'opening a new file adds a tab');
  assert.equal(tabs.find(t => t.name === 'a.md').active, true);

  // 再打开一个 → 再追加。
  await openDocument(fileB);
  await waitFor("document.querySelector('#file-name').textContent === 'b.md'");
  tabs = await tabState();
  assert.equal(tabs.length, baseline.length + 2);
  assert.equal(tabs.find(t => t.name === 'b.md').active, true);
  assert.match(await run("$('#content').textContent"), /Beta/);

  // 打开已存在的文件 → 切换到它，不新增标签。
  await openDocument(fileA);
  await waitFor("document.querySelector('#file-name').textContent === 'a.md'");
  tabs = await tabState();
  assert.equal(tabs.length, baseline.length + 2, 're-opening an open file switches instead of duplicating');
  assert.equal(tabs.find(t => t.name === 'a.md').active, true);
  assert.match(await run("$('#content').textContent"), /Alpha/);

  // 用 switchTab 切换，并把当前草稿一并交给主进程。
  const idA = tabs.find(t => t.name === 'a.md').id;
  const idB = tabs.find(t => t.name === 'b.md').id;
  await run(`switchToTab(${idB})`);
  await waitFor("document.querySelector('#file-name').textContent === 'b.md'");
  assert.match(await run("$('#content').textContent"), /Beta/);

  // 编辑 A 使其 dirty，切走再切回，草稿保留。
  await run(`switchToTab(${idA})`);
  await waitFor("document.querySelector('#file-name').textContent === 'a.md'");
  await run("toggleEditing()");
  await run("richEditor.editor.commands.insertContentAt(1, 'Edited ')");
  assert.match(await run('payload().source'), /Edited Alpha/);
  tabs = await tabState();
  assert.equal(tabs.find(t => t.name === 'a.md').dirty, true, 'edited tab shows dirty marker');
  await run(`switchToTab(${idB})`);
  await waitFor("document.querySelector('#file-name').textContent === 'b.md'");
  await run(`switchToTab(${idA})`);
  await waitFor("document.querySelector('#file-name').textContent === 'a.md'");
  assert.match(await run('payload().source'), /Edited Alpha/, 'unsaved draft survives tab switch');

  // 新建 → 追加标签，不替换。
  await run("document.querySelector('#tab-bar .tab.active .tab-name').dispatchEvent(new MouseEvent('dblclick', {bubbles:true, button:0}))");
  assert.equal((await tabState()).length, baseline.length + 2, 'double-clicking an existing tab must not create a document');
  await run("document.querySelector('#tab-bar').dispatchEvent(new MouseEvent('dblclick', {bubbles:true, button:0}))");
  await waitFor("document.querySelector('#file-name').textContent === '未命名.md'");
  tabs = await tabState();
  assert.equal(tabs.length, baseline.length + 3);
  assert.equal(await run('editing'), true, 'double-click creates an editable document');
  assert.equal(await run('richEditor.editor.getText()'), '', 'new document is empty');
  const unnamed = tabs.filter(t => t.name === '未命名.md');
  assert.ok(unnamed.length >= 1, 'new document adds an unnamed tab');

  // 关闭干净标签 → 移除，激活相邻标签。
  const idBlank = unnamed[unnamed.length - 1].id;
  await run(`closeTab(${idBlank})`);
  await waitFor(`![...document.querySelectorAll('#tab-bar .tab')].some(t => +t.dataset.id === ${idBlank})`);
  tabs = await tabState();
  assert.equal(tabs.length, baseline.length + 2, 'closing a clean tab removes it');

  // 关闭 dirty 标签 → 弹窗「取消」→ 保留。
  await run(`switchToTab(${idA})`);
  await waitFor("document.querySelector('#file-name').textContent === 'a.md'");
  await run("toggleEditing(); richEditor.editor.commands.insertContentAt(1, 'X ')");
  const originalDialog = dialog.showMessageBox;
  dialog.showMessageBox = async () => ({ response: 2 });
  try { await run(`closeTab(${idA})`); }
  finally { dialog.showMessageBox = originalDialog; }
  tabs = await tabState();
  assert.equal(tabs.length, baseline.length + 2, 'cancelling close keeps the tab');
  assert.equal(tabs.find(t => t.name === 'a.md').active, true);

  // 关闭 dirty 标签 → 「不保存」→ 移除。
  dialog.showMessageBox = async () => ({ response: 1 });
  try { await run(`closeTab(${idA})`); }
  finally { dialog.showMessageBox = originalDialog; }
  await waitFor(`![...document.querySelectorAll('#tab-bar .tab')].some(t => +t.dataset.id === ${idA})`);
  tabs = await tabState();
  assert.equal(tabs.length, baseline.length + 1, 'discarding changes closes the tab');
  assert.equal(tabs.some(t => t.name === 'a.md'), false);

  console.log('Tabs smoke: multi-tab open, switch, dirty tracking and close passed');
};
