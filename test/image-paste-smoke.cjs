const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { clipboard, ClipboardItem } = require('electron');
const { renderMarkdown, readDocument } = require('../src/markdown.cjs');
const { saveTextFile } = require('../src/document-file.cjs');
// Works in the actual desktop window or a sandboxed standalone BrowserWindow.
module.exports = async ({ win, app, outputDirectory }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(resolve => setTimeout(resolve, 180))');
  const original = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))));
  const directory = outputDirectory || await fs.mkdtemp(path.join(app.getPath('userData'), 'mdview-image-paste-'));
  await fs.mkdir(directory, { recursive: true });
  const mount = async source => {
    const doc = { source, ...await renderMarkdown(source) };
    await run(`window.pasteHarness?.destroy(); document.querySelector('#paste-harness')?.remove();
      { const host = document.createElement('div'); host.id='paste-harness'; document.body.append(host);
      window.pasteHarness = MdViewRich.create(host, ${JSON.stringify(doc)}, () => {}); pasteHarness.editor.commands.focus('end'); }`);
    await settle();
  };
  try {
    await mount('Before');
    assert.equal(await run('pasteHarness.source()'), 'Before', 'baseline source stays exact');
    const shot = await win.webContents.capturePage();
    assert.equal(shot.isEmpty(), false);
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([shot.resize({ width: 64, height: 48 }).toPNG()], { type: 'image/png' }) })]);
    win.webContents.paste();
    await settle();
    assert.equal(await run("!!pasteHarness.editor.view.dom.querySelector('img')"), true, 'real native screenshot paste displays');
    const source = await run('pasteHarness.source()');
    assert.match(source, /!\[.*\]\(data:image\/png;base64,/);
    assert.equal(await run('pasteHarness.editor.commands.undo()'), true);
    assert.equal(await run('pasteHarness.source()'), 'Before', 'one undo removes image only');
    await run('pasteHarness.editor.commands.redo()');
    const file = path.join(directory, 'embedded.md');
    await saveTextFile(file, await run('pasteHarness.source()'), { expectedHash: null });
    const reopened = await readDocument(file);
    await run(`pasteHarness.destroy(); window.pasteHarness=MdViewRich.create(document.querySelector('#paste-harness'),${JSON.stringify(reopened)},()=>{}); void 0;`);
    await settle();
    assert.equal(await run('pasteHarness.source()'), reopened.source);
    assert.equal(await run("pasteHarness.editor.view.dom.querySelector('img').naturalWidth"), 64);
    const copiedDirectory = path.join(directory, 'save-as');
    await fs.mkdir(copiedDirectory, { recursive: true });
    const copied = path.join(copiedDirectory, 'copy.md');
    await saveTextFile(copied, reopened.source, { expectedHash: null });
    const copiedDoc = await readDocument(copied);
    assert.equal(copiedDoc.source, reopened.source, 'Save As in another directory preserves self-contained image');
    assert.match(copiedDoc.html, /<img[^>]+data:image\/png;base64,/);
    // Recovery/tab reconstruction may provide editorHtml but no refreshed assets.
    const recoveryHtml = require('../src/markdown.cjs').renderEditorHtml(reopened.source);
    await run(`pasteHarness.destroy(); window.pasteHarness=MdViewRich.create(document.querySelector('#paste-harness'),{source:${JSON.stringify(reopened.source)},editorHtml:${JSON.stringify(recoveryHtml)},assets:{}},()=>{}); void 0;`);
    await settle();
    assert.equal(await run("pasteHarness.editor.view.dom.querySelector('img').naturalWidth"), 64, 'draft-only reconstruction renders safe embedded image');
    await fs.writeFile(path.join(directory, 'image-paste.png'), (await win.webContents.capturePage()).toPNG());
    await mount('');
    win.webContents.paste(); await settle();
    assert.match(await run('pasteHarness.source()'), /data:image\/png;base64,/,'unnamed document embeds image');
    await run('pasteHarness.editor.view.focus()');
    win.webContents.paste(); await settle();
    assert.equal(await run("(()=>{const p=pasteHarness.editor.state.doc.firstChild;return p.type.name==='paragraph' && p.childCount===2 && p.child(0).type.name==='image' && p.child(1).type.name==='image'})()"), true, 'consecutive native PNG pastes share a paragraph');
    const before = await run('pasteHarness.source()');
    assert.equal((await run('window.mdview.pasteImage(new Uint8Array([1,2,3]))')).ok, false);
    assert.equal(await run('pasteHarness.source()'), before, 'invalid input leaves content intact');
    await clipboard.write([new ClipboardItem({ 'text/plain': 'plain paste' })]);
    await run('pasteHarness.editor.commands.focus("end")');
    win.webContents.paste(); await settle();
    assert.match(await run('pasteHarness.editor.getText()'), /plain paste/, 'normal text paste remains unchanged');
    // A native paste starts async decoding; edits and a selection change made in
    // the following microtask must map the captured bookmark, not redirect it.
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([shot.resize({ width: 64, height: 48 }).toPNG()], { type: 'image/png' }) })]);
    await mount('left TARGET right');
    await run(`pasteHarness.editor.commands.focus(); pasteHarness.editor.commands.setTextSelection({from:6,to:12});
      pasteHarness.editor.view.dom.addEventListener('paste', () => queueMicrotask(() => {
        pasteHarness.editor.commands.insertContentAt(1,'PREFIX ');
        pasteHarness.editor.commands.setTextSelection(pasteHarness.editor.state.doc.content.size-1);
      }), {once:true});`);
    await run('pasteHarness.editor.view.focus()');
    win.webContents.paste(); await settle();
    assert.doesNotMatch(await run('pasteHarness.editor.getText()'), /TARGET/);
    assert.match(await run('pasteHarness.source()'), /PREFIX left[\s\S]*data:image\/png;base64,[\s\S]*right/);
    assert.equal(await run('pasteHarness.editor.commands.undo()'), true);
    assert.match(await run('pasteHarness.editor.getText()'), /PREFIX left TARGET right/, 'undo paste retains concurrent edit');
    await mount('old');
    await run(`pasteHarness.editor.view.dom.addEventListener('paste', () => queueMicrotask(() => {
      pasteHarness.destroy(); window.pasteHarness=MdViewRich.create(document.querySelector('#paste-harness'),{source:'new',editorHtml:'<p>new</p>'},()=>{});
    }), {once:true});`);
    await run('pasteHarness.editor.view.focus()');
    win.webContents.paste(); await settle();
    assert.equal(await run('pasteHarness.source()'), 'new', 'late result cannot reach a replacement editor');
    await require('./image-layout-smoke.cjs')({ win, outputDirectory: directory });
    await require('./image-move-smoke.cjs')({ win, outputDirectory: directory });
    console.log('Image paste smoke: native screenshot, undo/redo, disk reopen, unnamed document, invalid input, text, async bookmark and destroyed editor passed');
  } finally {
    await run('window.pasteHarness?.destroy(); document.querySelector("#paste-harness")?.remove()');
    await clipboard.write(original);
  }
};
