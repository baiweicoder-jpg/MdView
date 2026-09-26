const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ win, openDocument, app }) => {
  const run = code => win.webContents.executeJavaScript(code, true).catch(error => { console.error('Color test script:', code); throw error; });
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'mdview-colors-'));
  const file = path.join(dir, 'colors.md');
  await fs.writeFile(file, 'Color target\n\n==default== and \\==literal==\n\n<mark data-color="#fedcba">outer <span data-color="#123456">nested **bold**</span> end</mark>\n\n<mark data-color="#987654">outer <mark data-color="#456789">inner</mark> end</mark>\n\n<span data-color="#765432">first  \nsecond</span>\n\n\\<span data-color="#abcdef">literal tag</span>\n\n<span data-color="red" onclick="evil()">inert</span>\n');
  await fs.appendFile(file, '\n<span data-color="#102030">==foreground over highlight== [link](https://example.com)</span>\n');
  await openDocument(file);
  await settle();
  const theme = await run('document.documentElement.dataset.theme');
  try {
    for (const value of ['light', 'dark', 'warm']) {
      await run(`document.documentElement.dataset.theme = ${JSON.stringify(value)}`);
      assert.deepEqual(await run(`Array.from(document.querySelectorAll('#content span[data-color="#102030"] :is(mark,a)')).map(el => getComputedStyle(el).color)`), ['rgb(16, 32, 48)', 'rgb(16, 32, 48)']);
    }
  } finally { await run(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`); }
  if (!await run('editing')) await run('toggleEditing()');
  await settle();
  assert.equal(await run('!!document.querySelector("#highlight-color[type=color]")'), true, 'native highlight picker exists');
  assert.equal(await run('!!document.querySelector("#text-color[type=color]")'), true, 'native text picker exists');
  assert.equal(await run('!!document.querySelector("[data-edit=toggleHighlight]")'), false, 'redundant highlight button removed');
  await run(`richEditor.editor.commands.setTextSelection({from:1,to:6});
    document.querySelector('#highlight-color').dispatchEvent(new Event('pointerdown', {bubbles:true}));
    document.querySelector('#highlight-color').focus();
    document.querySelector('#highlight-color').value = '#aabbcc';
    document.querySelector('#highlight-color').dispatchEvent(new Event('input', {bubbles:true}));`);
  assert.equal(await run('richEditor.editor.getAttributes("highlight").color'), '#aabbcc', 'highlight applies before picker change/close');
  assert.equal(await run('document.activeElement.id'), 'highlight-color', 'preview does not steal picker focus');
  await run(`document.querySelector('#text-color').dispatchEvent(new Event('pointerdown', {bubbles:true}));
    document.querySelector('#text-color').focus();
    document.querySelector('#text-color').value = '#234567';
    document.querySelector('#text-color').dispatchEvent(new Event('input', {bubbles:true}));`);
  assert.equal(await run('richEditor.editor.getAttributes("textColor").color'), '#234567', 'text color applies before picker change/close');
  assert.equal(await run('document.activeElement.id'), 'text-color');
  await run(`document.querySelector('#text-color').value = '#345678'; document.querySelector('#text-color').dispatchEvent(new Event('input', {bubbles:true}));`);
  assert.equal(await run('richEditor.editor.getAttributes("textColor").color'), '#345678', 'continuous picker updates preserve selection');
  await run(`document.querySelector('#text-color').value = '#234567'; document.querySelector('#text-color').dispatchEvent(new Event('change', {bubbles:true}));`);
  await settle();
  assert.equal(await run('richEditor.editor.getAttributes("highlight").color'), '#aabbcc');
  assert.equal(await run('richEditor.editor.getAttributes("textColor").color'), '#234567');
  assert.equal(await run('document.querySelector("#highlight-color").dataset.active'), 'true');
  // Cancel a picker, return to the editor and move the selection, then activate
  // reset by keyboard (.click has no pointerdown). Never use the canceled range.
  await run(`document.querySelector('#text-color').dispatchEvent(new Event('pointerdown', {bubbles:true})); document.querySelector('#text-color').focus(); richEditor.editor.commands.focus();`);
  await settle();
  await run(`richEditor.editor.commands.setTextSelection({from:7,to:13}); document.querySelector('#reset-text-color').click(); richEditor.editor.commands.setTextSelection({from:1,to:6});`);
  assert.equal(await run('richEditor.editor.getAttributes("textColor").color'), '#234567', 'canceled picker cannot leave a stale reset selection');
  assert.deepEqual(await run(`(() => { const el = document.querySelector('#editor-content mark[data-color="#aabbcc"]'); const text = el.querySelector('span') || el.closest('span'); return [getComputedStyle(el).backgroundColor, getComputedStyle(text).color]; })()`), ['rgb(170, 187, 204)', 'rgb(35, 69, 103)']);
  await run('saveDocument()');
  const saved = await fs.readFile(file, 'utf8');
  assert.match(saved, /<mark data-color="#aabbcc">/);
  assert.match(saved, /<span data-color="#234567">/);
  assert.match(saved, /==default==/);
  assert.doesNotMatch(saved, /style=/);
  await run('window.mdview.reload()');
  await settle();
  assert.deepEqual(await run(`(() => { const el = document.querySelector('#content mark[data-color="#aabbcc"]'); const text = el.querySelector('span') || el.closest('span'); return [getComputedStyle(el).backgroundColor, getComputedStyle(text).color]; })()`), ['rgb(170, 187, 204)', 'rgb(35, 69, 103)']);
  assert.match(await run('document.querySelector("#content").textContent'), /==literal==/);
  assert.equal(await run('!!document.querySelector("#content [onclick]")'), false);
  if (!await run('editing')) await run('toggleEditing()');
  await run('richEditor.editor.commands.setTextSelection({from:1,to:6})');
  assert.equal(await run('richEditor.editor.getAttributes("highlight").color'), '#aabbcc');
  assert.equal(await run('richEditor.editor.getAttributes("textColor").color'), '#234567');
  await run('document.querySelector("#reset-text-color").click(); document.querySelector("#reset-highlight-color").click()');
  assert.equal(await run('richEditor.editor.isActive("highlight") || richEditor.editor.isActive("textColor")'), false);
  await run('saveDocument();');
  const reset = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(reset, /#aabbcc|#234567/);
  assert.match(reset, /#fedcba/);
  assert.match(reset, /#123456/);
  await run('window.mdview.reload()');
  if (!await run('editing')) await run('toggleEditing()');
  await run('richEditor.editor.commands.insertContentAt(1, "Again ");');
  await run('saveDocument()');
  await run('window.mdview.reload()');
  assert.match(await run('document.querySelector("#content").textContent'), /==literal==/);
  assert.equal(await run(`!!document.querySelector('#content span[data-color="#123456"] strong')`), true);
  assert.equal(await run(`document.querySelector('#content mark[data-color="#456789"]').textContent`), 'inner');
  // Tiptap emits edge whitespace outside mark wrappers; the paragraph text stays intact.
  assert.equal(await run(`Array.from(document.querySelectorAll('#content mark[data-color="#987654"]')).map(el => el.textContent).join('')`), 'outerend');
  assert.equal(await run(`document.querySelector('#content mark[data-color="#456789"]').closest('p').textContent`), 'outer inner end');
  assert.equal(await run(`Array.from(document.querySelectorAll('#content span[data-color="#765432"]')).map(el => el.textContent).join('').replace(/\\n/g, '')`), 'firstsecond');
  assert.match(await run('document.querySelector("#content").textContent'), /<span data-color="#abcdef">literal tag<\/span>/);
  assert.equal(await run(`!!document.querySelector('#content [data-color="#abcdef"]')`), false);
  console.log('Colors smoke: native pickers, selection, computed colors, reset and repeated disk reopen passed');
};
