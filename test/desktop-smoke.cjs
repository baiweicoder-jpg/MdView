const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');

module.exports = async ({ win, openDocument, app }) => {
  const evaluate = code => win.webContents.executeJavaScript(code);
  // Wait for a software offscreen frame; hidden GPU capturePage can fail with UnknownVizError.
  const capture = () => new Promise((resolve, reject) => {
    const painted = (_event, _dirty, image) => {
      if (image.isEmpty()) { win.webContents.invalidate(); return; }
      clearTimeout(timeout);
      win.webContents.removeListener('paint', painted);
      resolve(image);
    };
    const timeout = setTimeout(() => { win.webContents.removeListener('paint', painted); reject(new Error('Offscreen paint timed out')); }, 8000);
    win.webContents.on('paint', painted);
    win.webContents.invalidate();
  });
  async function waitFor(code) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await evaluate(code)) return;
      await delay(50);
    }
    throw new Error(`Timed out: ${code}`);
  }
  const artifacts = path.resolve('artifacts', app.isPackaged ? 'packaged' : 'desktop');
  await fs.mkdir(artifacts, { recursive: true });
  await waitFor("document.querySelectorAll('#content .hljs-keyword').length > 0");
  await waitFor("document.querySelector('.brand-icon').naturalWidth === 256");
  assert.deepEqual(await evaluate("({node: typeof require, process: typeof process, bridge: typeof window.mdview.open})"), { node: 'undefined', process: 'undefined', bridge: 'function' });
  const prefs = win.webContents.getLastWebPreferences();
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  const codeAppearance = selector => evaluate(`(() => {
    const block = document.querySelector(${JSON.stringify(selector)});
    const code = block.querySelector('code');
    const style = getComputedStyle(code);
    const pre = getComputedStyle(block.querySelector('pre'));
    return { html: code.innerHTML, fontSize: style.fontSize, fontFamily: style.fontFamily,
      color: style.color, lineHeight: style.lineHeight, whiteSpace: style.whiteSpace,
      background: pre.backgroundColor, padding: pre.padding,
      toolbar: getComputedStyle(block.querySelector('.code-toolbar')).backgroundColor,
      highlights: [...code.querySelectorAll('span')].map(span => getComputedStyle(span).color) };
  })()`);
  await evaluate("document.querySelector('.code-block [data-code-zoom=\"1\"]').click()");
  const themeColors = [];
  for (const theme of ['light', 'dark', 'warm']) {
    await evaluate(`document.querySelector('#theme').value = ${JSON.stringify(theme)}; document.querySelector('#theme').dispatchEvent(new Event('change'));`);
    themeColors.push(await evaluate("getComputedStyle(document.querySelector('.hljs-keyword')).color"));
    await delay(100);
    await fs.writeFile(path.join(artifacts, `${theme}.png`), (await capture()).toPNG());
    const original = await codeAppearance('#content .code-block');
    const readingScroll = await evaluate("document.querySelector('#reader').scrollTop");
    await evaluate("document.querySelector('#content .expand-code').click()");
    await waitFor("document.querySelector('#code-dialog').open");
    assert.deepEqual(await codeAppearance('#code-dialog .code-block'), original);
    assert.equal(await evaluate("document.querySelector('#code-dialog .code-zoom-reset').textContent"), '110%');
    assert.equal(await evaluate("document.querySelectorAll('#code-dialog .expand-code').length"), 0);
    assert.equal(await evaluate("!!document.querySelector('#code-dialog .copy-code')"), true);
    await delay(100);
    await fs.writeFile(path.join(artifacts, `dialog-${theme}.png`), (await capture()).toPNG());
    win.webContents.debugger.attach('1.3');
    try {
      const wheel = deltaY => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 550, y: 350, deltaX: 0, deltaY, modifiers: 2 });
      await wheel(-120);
      await waitFor("document.querySelector('#code-dialog .code-zoom-reset').textContent === '120%'");
      await wheel(120);
      await waitFor("document.querySelector('#code-dialog .code-zoom-reset').textContent === '110%'");
      assert.equal(await evaluate("document.querySelector('#font-size').textContent"), '16');
      assert.equal(win.webContents.getZoomFactor(), 1);
      assert.deepEqual(await codeAppearance('#content .code-block'), original);
      await evaluate("document.querySelector('#code-dialog .code-zoom-reset').click()");
      assert.equal(await evaluate("document.querySelector('#code-dialog .code-zoom-reset').textContent"), '100%');
      assert.deepEqual(await codeAppearance('#content .code-block'), original);
      if (theme === 'light') await evaluate("document.querySelector('#close-code-dialog').click()");
      else {
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      }
    } finally {
      win.webContents.debugger.detach();
    }
    await waitFor("!document.querySelector('#code-dialog').open && !document.querySelector('#code-dialog-content').children.length");
    assert.equal(await evaluate("document.activeElement.classList.contains('expand-code')"), true);
    assert.equal(await evaluate("document.querySelector('#reader').scrollTop"), readingScroll);
  }
  await evaluate("document.querySelector('#content .code-zoom-reset').click()");
  assert.equal(new Set(themeColors).size, 3);
  await evaluate("document.querySelector('.code-block').scrollIntoView({block: 'center', behavior: 'instant'})");
  await delay(100);
  await fs.writeFile(path.join(artifacts, 'code.png'), (await capture()).toPNG());
  await evaluate("document.querySelector('#font-up').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#content')).fontSize"), '17px');
  await win.webContents.reload();
  await waitFor("document.querySelector('#theme')?.value === 'warm' && document.querySelector('#font-size')?.textContent === '17'");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mdview-desktop-'));
  await fs.writeFile(path.join(directory, '图 片.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  const document = path.join(directory, '桌面 验证.md');
  await fs.writeFile(document, '# 本地文档\n\n![本地](图%20片.png)\n\n<script>window.injected = true</script>\n\n```js\nconst answer = 42;\n```\n\n    print("indented code")\n\n' + Array.from({ length: 30 }, (_, index) => `## 章节 ${index}\n\n这是一段用于验证目录跳转与滚动位置的正文。\n\n`).join(''));
  win.webContents.debugger.attach('1.3');
  try {
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await win.webContents.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 500, y: 300, data: { items: [], files: [document], dragOperationsMask: 1 } });
    }
  } finally {
    win.webContents.debugger.detach();
  }
  await waitFor("document.querySelector('#file-name').textContent === '桌面 验证.md' && document.querySelector('#content img')?.naturalWidth === 1");
  assert.equal(await evaluate('window.injected'), undefined);
  assert.equal(await evaluate("document.querySelectorAll('#outline a').length"), 31);
  const codeState = () => evaluate(`({
    sizes: [...document.querySelectorAll('.code-block pre code')].map(code => parseFloat(getComputedStyle(code).fontSize)),
    text: [...document.querySelectorAll('.code-block pre code')].map(code => code.textContent),
    body: getComputedStyle(document.querySelector('#content')).fontSize,
    toolbar: getComputedStyle(document.querySelector('.toolbar')).fontSize
  })`);
  const initial = await codeState();
  assert.equal(initial.sizes.length, 2);
  await evaluate("document.querySelector('.code-block [data-code-zoom=\"1\"]').click()");
  const enlarged = await codeState();
  assert.ok(enlarged.sizes[0] > initial.sizes[0]);
  assert.equal(enlarged.sizes[1], initial.sizes[1]);
  assert.equal(enlarged.body, initial.body);
  assert.deepEqual(enlarged.text, initial.text);
  await evaluate("document.querySelector('.code-block pre code').click()");
  assert.deepEqual((await codeState()).sizes, enlarged.sizes);
  await evaluate("for(let i=0;i<30;i++) document.querySelector('.code-block [data-code-zoom=\"-1\"]').click()");
  assert.equal(await evaluate("document.querySelector('.code-zoom-reset').textContent"), '70%');
  assert.equal(await evaluate("document.querySelector('.code-block [data-code-zoom=\"-1\"]').disabled"), true);
  await evaluate("for(let i=0;i<30;i++) document.querySelector('.code-block [data-code-zoom=\"1\"]').click()");
  assert.equal(await evaluate("document.querySelector('.code-zoom-reset').textContent"), '200%');
  assert.equal(await evaluate("document.querySelector('.code-block [data-code-zoom=\"1\"]').disabled"), true);
  await evaluate("document.querySelector('.code-zoom-reset').click()");
  assert.deepEqual((await codeState()).sizes, initial.sizes);
  await evaluate("document.querySelectorAll('.code-block')[1].querySelector('[data-code-zoom=\"1\"]').click()");
  assert.ok((await codeState()).sizes[1] > initial.sizes[1]);
  await evaluate("document.querySelectorAll('.code-block')[1].querySelector('.code-zoom-reset').click()");
  win.webContents.debugger.attach('1.3');
  try {
    const wheel = (deltaY, modifiers = 2) => win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 550, y: 350, deltaX: 0, deltaY, modifiers });
    await wheel(-120);
    await waitFor("document.querySelector('#font-size').textContent === '18'");
    assert.ok((await codeState()).sizes.every((size, index) => size > initial.sizes[index]));
    assert.equal((await codeState()).toolbar, initial.toolbar);
    assert.equal(win.webContents.getZoomFactor(), 1);
    await wheel(120);
    await waitFor("document.querySelector('#font-size').textContent === '17'");
    await evaluate("document.querySelector('#reader').scrollTo({top: 0, behavior: 'instant'})");
    await wheel(180, 0);
    await waitFor("document.querySelector('#reader').scrollTop > 0");
    assert.equal(await evaluate("document.querySelector('#font-size').textContent"), '17');
    await evaluate("for(let i=0;i<30;i++) document.querySelector('#font-up').click()");
    await wheel(-120);
    await delay(100);
    assert.equal(await evaluate("document.querySelector('#font-size').textContent"), '24');
    await evaluate("for(let i=0;i<30;i++) document.querySelector('#font-down').click()");
    await wheel(120);
    await delay(100);
    assert.equal(await evaluate("document.querySelector('#font-size').textContent"), '13');
    await evaluate("for(let i=0;i<3;i++) document.querySelector('#font-up').click()");
    await wheel(-120);
    await waitFor("document.querySelector('#font-size').textContent === '17'");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('mdview-preferences')).fontSize"), 17);
  } finally {
    win.webContents.debugger.detach();
  }
  await evaluate("document.querySelectorAll('#outline a')[10].click()");
  await waitFor("document.querySelector('#reader').scrollTop > 300");
  await delay(700);
  const scrollBefore = await evaluate("document.querySelector('#reader').scrollTop");
  await evaluate("document.querySelector('#theme').value = 'dark'; document.querySelector('#theme').dispatchEvent(new Event('change'));");
  assert.equal(await evaluate("document.querySelector('#reader').scrollTop"), scrollBefore);
  await fs.appendFile(document, '\n## 新增章节\n\n刷新后的内容。');
  await evaluate("document.querySelectorAll('#content .expand-code')[1].click()");
  assert.equal(await evaluate("document.querySelector('#code-dialog code').textContent"), 'print("indented code")\n');
  await evaluate('window.mdview.reload()');
  await waitFor("document.querySelectorAll('#outline a').length === 32");
  await waitFor("!document.querySelector('#code-dialog').open && !document.querySelector('#code-dialog-content').children.length");
  await openDocument(path.join(directory, 'missing.md'), false);
  await waitFor("!document.querySelector('#notice').hidden");
  assert.equal(await evaluate("document.querySelector('#file-name').textContent"), '桌面 验证.md');
  await evaluate("document.querySelector('#toggle-outline').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#sidebar')).display"), 'none');
  await evaluate("document.querySelector('#toggle-outline').click(); document.querySelector('#font-down').click(); document.querySelector('#theme').value = 'light'; document.querySelector('#theme').dispatchEvent(new Event('change'));");
  await openDocument(path.join(app.getAppPath(), 'examples', '欢迎使用.md'), false);
  await waitFor("document.querySelector('#file-name').textContent === '欢迎使用.md'");
  win.setSize(800, 650);
  await evaluate("document.querySelector('#reader').scrollTo({top: 0, behavior: 'instant'})");
  await delay(100);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await fs.writeFile(path.join(artifacts, 'narrow.png'), (await capture()).toPNG());
  await evaluate("document.querySelector('#content .expand-code').click()");
  await delay(100);
  assert.equal(await evaluate("(() => { const d = document.querySelector('#code-dialog'); const r = d.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && d.scrollWidth <= d.clientWidth; })()"), true);
  await fs.writeFile(path.join(artifacts, 'dialog-narrow.png'), (await capture()).toPNG());
  const report = { packaged: app.isPackaged, electron: process.versions.electron, checks: ['Markdown and syntax highlighting', 'renderer sandbox and context isolation', 'three theme palettes', 'dialog preserves highlighted HTML and computed styles in all themes', 'dialog Ctrl+wheel and reset isolate source and reading font', 'dialog close button and Escape restore focus and reading position', 'indented code dialog closes on document refresh', 'dialog fits narrow window', 'font and theme persistence across reload', 'native file drag and drop with Unicode and space paths', 'local image decoding', 'HTML injection inert', 'independent fenced and indented code zoom, limits and reset', 'Ctrl+wheel font zoom, bounds and saved preference', 'ordinary wheel scroll and unchanged interface zoom', 'outline navigation', 'theme preserves scroll', 'document refresh', 'missing file preserves content', 'outline toggle', '800px layout'], screenshotDirectory: artifacts };
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
};
