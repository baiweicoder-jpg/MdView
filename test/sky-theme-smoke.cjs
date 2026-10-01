const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, Menu } = require('electron');

module.exports = async ({ win, openDocument }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),100))');
  const source = '# 天蓝 · 清晰阅读\n\n以天空蓝组织层级，用 **粉红色突出重点**，保留清晰的正文与 `inline_code`。\n\n> 浅蓝底色、明确边界，让长篇文档更易阅读。\n\n| 内容 | 表现 |\n| --- | --- |\n| 重点文字 | 粉红强调 |\n| 表格边框 | 高对比蓝色 |\n\n```txt\n状态：通过\n下一步：渐进重构，保留协议资产\n```\n\n```js\nconst message = "hello"; // readable comment\nconsole.log(message);\n```\n\n```text\ntext alias\n```\n\n```plaintext\nplaintext alias\n```\n\n```\nplain text\n```\n';
  const file = path.join(app.getPath('userData'), 'sky-theme.md');
  fs.writeFileSync(file, source);
  await openDocument(file); await settle();
  const menu = () => Menu.getApplicationMenu();
  assert.ok(menu().getMenuItemById('theme-sky'), 'native menu exposes Sky blue');
  menu().getMenuItemById('theme-sky').click(); await settle();
  assert.equal(await run('document.documentElement.dataset.theme'), 'sky');
  const luminance = color => {
    const values = color.match(/[\d.]+/g).slice(0, 3).map(value => {
      const c = Number(value) / 255;
      return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
  };
  const contrast = (a, b) => {
    const [lo, hi] = [luminance(a), luminance(b)].sort((x, y) => x - y);
    return (hi + .05) / (lo + .05);
  };
  const check = async root => {
    const palette = await run(`(() => { const root=document.querySelector(${JSON.stringify(root)}),s=q=>getComputedStyle(root.querySelector(q)); return {bg:getComputedStyle(document.body).backgroundColor,txt:[...root.querySelectorAll('pre code')].filter(c=>!c.querySelector('.hljs-keyword')).map(c=>getComputedStyle(c).color),pairs:[ [getComputedStyle(root).color,getComputedStyle(document.body).backgroundColor], [s('strong').color,getComputedStyle(document.body).backgroundColor], [s('p code').color,s('p code').backgroundColor], [s('blockquote').color,s('blockquote').backgroundColor], [s('th').color,s('th').backgroundColor], ...['pre code','.hljs-keyword','.hljs-string','.hljs-comment'].map(q=>[s(q).color,s('pre').backgroundColor]), [s('.code-toolbar').color,s('.code-toolbar').backgroundColor]],border:s('td').borderTopColor,borderStyle:s('td').borderTopStyle,header:s('th').backgroundColor,cell:s('td').backgroundColor}; })()`);
    assert.equal(palette.bg, 'rgb(240, 248, 255)');
    assert.equal(palette.txt.length, 4);
    for (const color of palette.txt) assert.equal(color, 'rgb(255, 181, 213)', 'TXT and plain aliases use pink');
    for (const [fg, bg] of palette.pairs) assert.ok(contrast(fg, bg) >= 4.5, `${root}: ${fg} on ${bg}`);
    assert.equal(palette.borderStyle, 'solid');
    for (const bg of [palette.header, palette.cell]) assert.ok(contrast(palette.border, bg) >= 3, `table border contrast: ${bg}`);
    let previous = 0;
    for (const width of [720, 1100, 1600]) {
      win.setSize(width, 900); await settle();
      const g = await run(`(() => {const host=document.querySelector('#reader'),s=getComputedStyle(host),r=document.querySelector(${JSON.stringify(root)}).getBoundingClientRect();return {width:r.width,available:host.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),overflow:host.scrollWidth>host.clientWidth}})()`);
      assert.ok(Math.abs(g.width - g.available) < 2);
      assert.ok(g.width > previous); previous = g.width;
      assert.equal(g.overflow, false);
    }
  };
  win.setMinimumSize(320, 300);
  await check('#content');
  assert.equal(await run('currentDocument.source'), source);
  await run('if(!editing) toggleEditing()'); await settle();
  await check('#editor-content');
  const before = await run('JSON.stringify(richEditor.editor.getJSON())');
  const saved = await run('richEditor.source()');
  await run('richEditor.editor.commands.setTextSelection(2)');
  for (const theme of ['review', 'light', 'dark', 'warm', 'sky']) {
    menu().getMenuItemById(`theme-${theme}`).click(); await settle();
    assert.equal(await run('JSON.stringify(richEditor.editor.getJSON())'), before);
    assert.equal(await run('richEditor.source()'), saved);
    assert.equal(await run('richEditor.editor.state.selection.from'), 2);
  }
  await run('document.querySelector("#editor-content .expand-code").click()');
  assert.equal(await run('getComputedStyle(codeDialog.querySelector("pre code")).color'), 'rgb(255, 181, 213)');
  await run('codeDialog.close();changeLanguage("en");openSettings()'); await settle();
  assert.equal(menu().getMenuItemById('theme-sky').label, 'Sky blue');
  await run('document.querySelector("#theme-trigger").click()'); await settle();
  assert.match(await run('document.querySelector("#theme-listbox [data-value=sky]").textContent'), /Sky blue/);
  await run('document.querySelector("#theme-listbox [data-value=light]").click()'); await settle();
  await run('document.querySelector("#theme-trigger").click()'); await settle();
  await run('document.querySelector("#theme-listbox [data-value=sky]").click()'); await settle();
  assert.equal(await run('document.documentElement.dataset.theme'), 'sky');
  await run('document.querySelector("#settings-dialog").close();changeLanguage("zh-CN");if(editing) toggleEditing()'); await settle();
  assert.equal(menu().getMenuItemById('theme-sky').label, '天蓝');
  const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload(); await loaded; await settle();
  assert.equal(await run('document.documentElement.dataset.theme'), 'sky');
  assert.equal(menu().getMenuItemById('theme-sky').checked, true);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  const preview = path.join(app.getPath('userData'), 'sky-theme-preview.md');
  fs.writeFileSync(preview, source); await openDocument(preview); await settle();
  win.setSize(1280, 1000); await run('if(editing) toggleEditing();reader.scrollTop=0'); await settle();
  assert.equal(await run('document.querySelector("#content h1").textContent'), '天蓝 · 清晰阅读');
  const artifacts = path.join(__dirname, '..', 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  fs.writeFileSync(path.join(artifacts, 'sky-theme.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS Sky blue: menu/settings/locales, reader/editor/dialog, TXT aliases, text and border contrast, fluid widths, source/model/selection preservation, reload');
};

if (process.versions.electron && process.argv.some(arg => path.resolve(arg) === __filename)) {
  app.setPath('userData', fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-sky-theme-')));
  app.disableHardwareAcceleration();
  const timer = setTimeout(() => { console.error('Sky theme timeout'); app.exit(1); }, 90000);
  require('../src/main.cjs').then(async context => {
    try { await module.exports(context); clearTimeout(timer); app.exit(0); }
    catch (error) { console.error(error); app.exit(1); }
  });
}
