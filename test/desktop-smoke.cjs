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
  const themeColors = [];
  for (const theme of ['light', 'dark', 'warm']) {
    await evaluate(`document.querySelector('#theme').value = ${JSON.stringify(theme)}; document.querySelector('#theme').dispatchEvent(new Event('change'));`);
    themeColors.push(await evaluate("getComputedStyle(document.querySelector('.hljs-keyword')).color"));
    await delay(100);
    await fs.writeFile(path.join(artifacts, `${theme}.png`), (await capture()).toPNG());
  }
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
  await fs.writeFile(document, '# 本地文档\n\n![本地](图%20片.png)\n\n<script>window.injected = true</script>\n\n' + Array.from({ length: 30 }, (_, index) => `## 章节 ${index}\n\n这是一段用于验证目录跳转与滚动位置的正文。\n\n`).join(''));
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
  await evaluate("document.querySelectorAll('#outline a')[10].click()");
  await waitFor("document.querySelector('#reader').scrollTop > 300");
  await delay(700);
  const scrollBefore = await evaluate("document.querySelector('#reader').scrollTop");
  await evaluate("document.querySelector('#theme').value = 'dark'; document.querySelector('#theme').dispatchEvent(new Event('change'));");
  assert.equal(await evaluate("document.querySelector('#reader').scrollTop"), scrollBefore);
  await fs.appendFile(document, '\n## 新增章节\n\n刷新后的内容。');
  await evaluate('window.mdview.reload()');
  await waitFor("document.querySelectorAll('#outline a').length === 32");
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
  const report = { packaged: app.isPackaged, electron: process.versions.electron, checks: ['Markdown and syntax highlighting', 'renderer sandbox and context isolation', 'three theme palettes', 'font and theme persistence across reload', 'native file drag and drop with Unicode and space paths', 'local image decoding', 'HTML injection inert', 'outline navigation', 'theme preserves scroll', 'document refresh', 'missing file preserves content', 'outline toggle', '800px layout'], screenshotDirectory: artifacts };
  await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
};
