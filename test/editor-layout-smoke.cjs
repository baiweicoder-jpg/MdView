const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ win, app, openDocument }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const file = path.join(app.getPath('userData'), 'editor-layout.md');
  await fs.writeFile(file, '- [ ] First task\n- [x] Done task\n  - [ ] Nested task\n- Ordinary bullet\n\nParagraph for zoom.\n');
  await openDocument(file);
  const header = await run(`(() => {
    const nodes = ['.eyebrow', '#file-name', '#file-path'].map(selector => document.querySelector(selector));
    const boxes = nodes.map(node => node.getBoundingClientRect());
    return { height: document.querySelector('.document-header').getBoundingClientRect().height,
      centers: boxes.map(box => box.top + box.height / 2),
      nowrap: nodes.every(node => getComputedStyle(node).whiteSpace === 'nowrap') };
  })()`);
  assert.ok(header.height <= 42, 'document information uses a compact single row');
  assert.ok(Math.max(...header.centers) - Math.min(...header.centers) < 3, 'type, filename and path align on one line');
  assert.equal(header.nowrap, true);
  await run('toggleEditing()');
  const taskGeometry = () => run(`(() => {
    const input = document.querySelector('#editor-content input[type=checkbox]');
    const li = input.closest('li');
    const paragraph = li.querySelector('div > p');
    const a = input.getBoundingClientRect(), b = paragraph.getBoundingClientRect();
    return { display: getComputedStyle(li).display, listStyle: getComputedStyle(li).listStyleType,
      gap: b.left - a.right, top: b.top, checkboxCenter: a.top + a.height / 2, lineHeight: parseFloat(getComputedStyle(paragraph).lineHeight) };
  })()`);
  const geometry = await taskGeometry();
  assert.equal(geometry.display, 'flex', 'editor task node uses an inline checkbox/text row');
  assert.equal(geometry.listStyle, 'none', 'task item has no bullet');
  assert.ok(geometry.gap >= 0 && geometry.gap < 16, 'text immediately follows checkbox');
  assert.ok(geometry.checkboxCenter >= geometry.top && geometry.checkboxCenter < geometry.top + geometry.lineHeight, 'checkbox aligns with first line');
  assert.equal(await run("getComputedStyle([...document.querySelectorAll('#editor-content li')].find(li => li.textContent === 'Ordinary bullet')).listStyleType"), 'disc');
  const source = await run('payload().source');
  const originalSize = await run('fontSize');
  await run('fontSize = 16; applyFont(); reader.scrollTo({top:0, behavior:"instant"})');
  // A real Chromium wheel event over the editable document, not a direct handler call.
  win.webContents.debugger.attach('1.3');
  try {
    const point = await run("(() => { const r = document.querySelector('#editor-content .ProseMirror').getBoundingClientRect(); return { x: r.left + 30, y: Math.min(innerHeight - 70, r.top + 15) }; })()");
    const wheel = deltaY => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY, modifiers: 2 });
    const before = await run("parseFloat(getComputedStyle(document.querySelector('#editor-content .ProseMirror')).fontSize)");
    await wheel(-120); await delay(150);
    assert.equal(await run('fontSize'), 17);
    assert.ok(await run("parseFloat(getComputedStyle(document.querySelector('#editor-content .ProseMirror')).fontSize)") > before);
    await wheel(120); await delay(150);
    assert.equal(await run('fontSize'), 16);
    await run(`(() => {
      const editor = document.querySelector('#editor-content .ProseMirror');
      editor.addEventListener('wheel', event => event.stopPropagation(), { once: true });
      editor.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, bubbles: true, cancelable: true }));
    })()`);
    assert.equal(await run('fontSize'), 17, 'capture listener handles wheel even if an editor node consumes bubbling');
    assert.equal(win.webContents.getZoomFactor(), 1);
    assert.equal(await run('payload().source'), source, 'zoom changes presentation, not document content');
  } finally { win.webContents.debugger.detach(); await run(`fontSize = ${originalSize}; applyFont()`); }
  console.log('Editor layout smoke: inline task rows without bullets, ordinary bullets preserved, editable Ctrl+wheel passed');
};
