const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async ({ win, openDocument, app }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const dir = await fs.mkdtemp(path.join(app.getPath('temp'), 'mdview-extended-'));
  const file = path.join(dir, 'extended.md');
  const source = '# Extended\n\n- [ ] Todo\n- [X] Done\n  - [x] Nested\n- Plain sibling\n\n==highlight **bold**== and <u>underline</u> and ~~strike~~ and `inline`.\n\n#### Four\n\n##### Five\n\n###### Six\n\n---\n\n<u onclick="alert(1)">unsafe</u>\n\n<script>alert(1)</script>\n';
  await fs.writeFile(file, source);
  await openDocument(file);
  if (!await run('editing')) await run('toggleEditing()');
  assert.equal(await run('payload().source'), source, 'unchanged source remains byte-for-byte intact');
  assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("input[type=checkbox]").length'), 3);
  assert.equal(await run('!!richEditor.editor.view.dom.querySelector("mark")'), true);
  assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("u").length'), 1);
  assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("h4,h5,h6").length'), 3);
  await run('richEditor.editor.view.dom.querySelector("input[type=checkbox]").click(); richEditor.editor.commands.insertContentAt(1, "Changed ")');
  await run('saveDocument()');
  const saved = await fs.readFile(file, 'utf8');
  assert.match(saved, /- \[x\] Todo/);
  assert.match(saved, /- \[x\] Nested/);
  assert.match(saved, /- Plain sibling/);
  assert.match(saved, /==highlight \*\*bold\*\*==/);
  assert.match(saved, /<u>underline<\/u>/);
  assert.match(saved, /~~strike~~/);
  assert.match(saved, /`inline`/);
  assert.match(saved, /###### Six/);
  await run('window.mdview.reload()');
  if (!await run('editing')) await run('toggleEditing()');
  assert.equal(await run('richEditor.editor.view.dom.querySelector("input[type=checkbox]").checked'), true);
  assert.equal(await run('!!richEditor.editor.view.dom.querySelector("mark") && richEditor.editor.view.dom.querySelectorAll("u").length === 1'), true);
  assert.equal(await run('!!richEditor.editor.view.dom.querySelector("script,[onclick]")'), false);
  assert.match(await run('richEditor.editor.getText()'), /Plain sibling/);
  const stable = await run('richEditor.editor.getMarkdown()');
  await run('richEditor.editor.commands.insertContentAt(1, "Again "); saveDocument()');
  assert.match(await fs.readFile(file, 'utf8'), /Again Changed/);
  assert.match(stable, /<u>underline<\/u>/);
  // An unrelated edit must force serialization instead of returning cached source.
  const literalFile = path.join(dir, 'literal-highlight.md');
  await fs.writeFile(literalFile, '\\==literal==\n\nAnother paragraph\n');
  await openDocument(literalFile);
  if (!await run('editing')) await run('toggleEditing()');
  assert.equal(await run('richEditor.editor.view.dom.querySelector("p").textContent'), '==literal==');
  assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("mark").length'), 0);
  await run('richEditor.editor.commands.insertContentAt(richEditor.editor.state.doc.content.size - 1, " edited"); saveDocument()');
  assert.match(await fs.readFile(literalFile, 'utf8'), /Another paragraph edited/);
  await run('window.mdview.reload()');
  if (!await run('editing')) await run('toggleEditing()');
  assert.equal(await run('richEditor.editor.view.dom.querySelector("p").textContent'), '==literal==');
  assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("mark").length'), 0, 'escaped literal delimiters remain literal after unrelated edit/save/reload');
  const delimiterFile = path.join(dir, 'highlight-interior.md');
  const delimiterSource = [
    'one==two',
    '==intentional **bold**==',
    String.raw`==\=edge\=\=\= **bold\=\=text** end\===`,
    String.raw`[\=\=label\=\=](https://example.com/?value==target "title==value")`,
    '`code==literal==`',
    '```text\nfenced==literal==\n```',
    '    indented==literal==',
    String.raw`backslash \\\=\=literal\=\= and \=single and \=\=\=run\=\=\=`,
    '\uE000MDVIEWEQUALS\uE001 and \uE000MDVIEWEQUALSX\uE001',
    'Another paragraph',
  ].join('\n\n') + '\n';
  await fs.writeFile(delimiterFile, delimiterSource);
  await openDocument(delimiterFile);
  if (!await run('editing')) await run('toggleEditing()');
  await run('richEditor.editor.commands.setTextSelection({from:1,to:9}); richEditor.editor.commands.toggleHighlight()');
  assert.equal(await run('richEditor.editor.view.dom.querySelector("mark").textContent'), 'one==two');
  // Capture semantic content, including nested marks, link attrs and code nodes.
  // Tiptap's existing code serializer adds trailing newlines on reload; compare
  // code payloads without those newlines, but keep exact inline text/mark attrs.
  const contentSnapshot = async () => {
    const content = await run('richEditor.editor.getJSON().content.slice(0, -1)');
    for (const node of content) {
      if (node.type === 'codeBlock') {
        for (const child of node.content || []) child.text = child.text.replace(/\n+$/, '');
      }
    }
    return content;
  };
  const expectedContent = await contentSnapshot();
  await run('richEditor.editor.commands.insertContentAt(richEditor.editor.state.doc.content.size - 1, " edited"); saveDocument()');
  const delimiterSaved = await fs.readFile(delimiterFile, 'utf8');
  assert.match(delimiterSaved, /==one\\=\\=two==/);
  assert.ok(delimiterSaved.includes('==intentional **bold**=='), 'intentional wrappers remain syntax');
  assert.ok(delimiterSaved.includes('(https://example.com/?value==target "title==value")'), `link destination/title are not escaped: ${delimiterSaved}`);
  assert.ok(delimiterSaved.includes('`code==literal==`'), 'inline code is not escaped');
  assert.ok(delimiterSaved.includes('fenced==literal=='), 'fenced code is not escaped');
  assert.ok(delimiterSaved.includes('indented==literal=='), 'indented code is not escaped');
  for (let cycle = 0; cycle < 2; cycle++) {
    await run('window.mdview.reload()');
    if (!await run('editing')) await run('toggleEditing()');
    assert.deepEqual(await contentSnapshot(), expectedContent, 'literal equals, highlight interiors, nested marks, links, code and placeholder-like text survive reload');
    assert.equal(await run('richEditor.editor.view.dom.querySelector("mark").textContent'), 'one==two');
    await run('richEditor.editor.commands.insertContentAt(richEditor.editor.state.doc.content.size - 1, " again"); saveDocument()');
  }
  console.log('Highlight delimiter smoke: escaped literal, highlighted interior, nested marks, backslashes, equals runs, links, code and repeated save/reload passed');
  await run('window.mdview.newDocument()');
  await run('richEditor.editor.commands.insertContent("format me"); richEditor.editor.commands.setTextSelection({from:1,to:10})');
  for (const [command, mark] of [['toggleStrike', 'strike'], ['toggleUnderline', 'underline'], ['toggleHighlight', 'highlight'], ['toggleCode', 'code']]) {
    await run(`document.querySelector('[data-edit="${command}"]').click()`);
    assert.equal(await run(`richEditor.editor.isActive('${mark}')`), true, `${command} applies its mark`);
    assert.equal(await run(`document.querySelector('[data-edit="${command}"]').getAttribute('aria-pressed')`), 'true');
    await run(`document.querySelector('[data-edit="${command}"]').click()`);
  }
  for (const level of [4, 5, 6]) {
    await run(`document.querySelector('#block-type').value = '${level}'; document.querySelector('#block-type').dispatchEvent(new Event('change'))`);
    assert.equal(await run(`richEditor.editor.isActive('heading', {level:${level}})`), true);
  }
  await run('richEditor.editor.commands.setTextSelection(1); document.querySelector("[data-edit=insertDate]").click()');
  assert.match(await run('richEditor.editor.getText()'), /^\d{4}-\d{2}-\d{2}format me/);
  await run('richEditor.editor.commands.setTextSelection(richEditor.editor.state.doc.content.size - 1); document.querySelector("[data-edit=setHorizontalRule]").click()');
  assert.equal(await run('!!richEditor.editor.view.dom.querySelector("hr")'), true);
  console.log('Extended Markdown smoke: task toggle, nested/mixed lists, marks, headings, date, rule, save/reload and inert HTML passed');
};
