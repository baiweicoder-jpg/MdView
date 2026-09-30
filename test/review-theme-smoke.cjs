const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, Menu } = require('electron');

module.exports = async ({ win, openDocument }) => {
  const run = code => win.webContents.executeJavaScript(code, true);
  const settle = () => run('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),100))');
  const file = path.join(app.getPath('userData'), 'review-theme.md');
  const source = '# 审阅纸主题\n\n正文与 `inline_code`。\n\n## 证据与建议\n\n> 保留协议资产，逐步修复。\n\n- [ ] 待验证\n- 普通项目\n\n| 指标 | 结果 |\n| --- | --- |\n| 验证 | 通过 |\n\n```js\nconst message = "hello"; // comment\n' + 'console.log(message);'.repeat(30) + '\n```\n\n```bash\nPYTHONDONTWRITEBYTECODE=1 python -m unittest\n```\n';
  fs.writeFileSync(file, source);
  await openDocument(file);
  await settle();
  const menu = () => Menu.getApplicationMenu();
  assert.ok(menu().getMenuItemById('theme-review'), 'native menu exposes Review paper');
  assert.equal(await run('!!document.querySelector("#theme option[value=review]")'), true);
  menu().getMenuItemById('theme-review').click();
  await settle();
  assert.equal(await run('document.documentElement.dataset.theme'), 'review');
  assert.equal(menu().getMenuItemById('theme-review').checked, true);
  const checkFluidWidth = async root => {
    const widths = [];
    for (const width of [1000, 1400, 1800]) {
      win.setSize(width, 900); await settle();
      const geometry = await run(`(() => {const host=document.querySelector('#reader'),style=getComputedStyle(host),content=document.querySelector(${JSON.stringify(root)}),header=host.querySelector('.document-header');return {available:host.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),width:content.getBoundingClientRect().width,header:header.getBoundingClientRect().width,overflow:host.scrollWidth>host.clientWidth}})()`);
      assert.ok(Math.abs(geometry.width - geometry.available) < 2, `${root} fills available width at ${width}px: ${JSON.stringify(geometry)}`);
      assert.ok(Math.abs(geometry.width - geometry.header) < 2, 'header and body stay aligned');
      assert.equal(geometry.overflow, false, 'long code scrolls inside its block');
      widths.push(geometry.width);
    }
    assert.ok(widths[2] > widths[1] + 200, 'wide windows must not plateau at a fixed reading width');
    console.log('Review fluid widths', root, widths);
  };
  await checkFluidWidth('#content');
  const checkPalette = async root => {
    const palette = await run(`(() => {const root=document.querySelector(${JSON.stringify(root)}),style=s=>getComputedStyle(root.querySelector(s));return {bg:getComputedStyle(document.body).backgroundColor,code:style('pre').backgroundColor,text:style('pre code').color,keyword:style('.hljs-keyword').color,string:style('.hljs-string').color,inline:style('p code').backgroundColor,heading:style('h1').fontFamily,toolbar:style('.code-toolbar').color}})()`);
    assert.equal(palette.bg, 'rgb(245, 244, 239)');
    assert.equal(palette.code, 'rgb(32, 44, 48)');
    assert.equal(palette.text, 'rgb(226, 233, 229)');
    assert.equal(palette.keyword, 'rgb(169, 201, 220)');
    assert.equal(palette.string, 'rgb(190, 208, 172)');
    assert.equal(palette.inline, 'rgb(233, 238, 234)');
    assert.match(palette.heading, /Songti|SimSun/);
    assert.equal(palette.toolbar, 'rgb(193, 206, 202)');
    const luminance = color => {
      const [r, g, b] = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * r + .7152 * g + .0722 * b;
    };
    const pairs = await run(`(() => {const root=document.querySelector(${JSON.stringify(root)}),style=s=>getComputedStyle(root.querySelector(s)),host=getComputedStyle(root);return [[host.color,getComputedStyle(document.body).backgroundColor],[style('p code').color,style('p code').backgroundColor],[style('blockquote').color,style('blockquote').backgroundColor],[style('th').color,style('th').backgroundColor],...['pre code','.hljs-keyword','.hljs-string','.hljs-comment'].map(s=>[style(s).color,style('pre').backgroundColor]),[style('.code-toolbar').color,style('.code-toolbar').backgroundColor]]})()`);
    for (const [foreground, background] of pairs) {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
      assert.ok((values[1] + .05) / (values[0] + .05) >= 4.5, `readable theme colors: ${foreground} on ${background}`);
    }
  };
  await checkPalette('#content');
  assert.equal(await run('currentDocument.source'), source);
  await run('if(!editing) toggleEditing()'); await settle();
  await checkFluidWidth('#editor-content');
  await checkPalette('#editor-content');
  const before = await run('JSON.stringify(richEditor.editor.getJSON())');
  const saved = await run('richEditor.source()');
  await run('richEditor.editor.commands.setTextSelection(2)');
  const selection = await run('richEditor.editor.state.selection.from');
  for (const theme of ['light', 'dark', 'warm', 'review']) {
    menu().getMenuItemById(`theme-${theme}`).click(); await settle();
    assert.equal(await run('document.documentElement.dataset.theme'), theme);
    assert.equal(await run('JSON.stringify(richEditor.editor.getJSON())'), before);
    assert.equal(await run('richEditor.source()'), saved);
    assert.equal(await run('richEditor.editor.state.selection.from'), selection);
  }
  await run('document.querySelector("#editor-content .expand-code").click()');
  assert.equal(await run('getComputedStyle(codeDialog.querySelector("pre")).backgroundColor'), 'rgb(32, 44, 48)');
  assert.equal(await run('getComputedStyle(codeDialog.querySelector(".hljs-keyword")).color'), 'rgb(169, 201, 220)');
  await run('codeDialog.close(); changeLanguage("en")'); await settle();
  assert.equal(await run('document.querySelector("#theme-status").textContent'), 'Review paper');
  assert.equal(menu().getMenuItemById('theme-review').label, 'Review paper');
  await run('openSettings()'); await settle();
  await run('document.querySelector("#theme-trigger").click()'); await settle();
  assert.equal(await run('document.querySelector("#theme-listbox [data-value=review]").textContent.trim().includes("Review paper")'), true);
  await run('document.querySelector("#theme-listbox [data-value=light]").click()'); await settle();
  assert.equal(await run('document.documentElement.dataset.theme'), 'light');
  await run('document.querySelector("#theme-trigger").click()'); await settle();
  await run('document.querySelector("#theme-listbox [data-value=review]").click()'); await settle();
  assert.equal(await run('document.documentElement.dataset.theme'), 'review');
  await run('document.querySelector("#settings-dialog").close(); changeLanguage("zh-CN")'); await settle();
  assert.equal(await run('document.querySelector("#theme-status").textContent'), '审阅纸');
  win.setMinimumSize(320, 300);
  win.setSize(720, 700); await settle();
  for (const mode of ['editor', 'reader']) {
    if (mode === 'reader') { await run('if(editing) toggleEditing()'); await settle(); }
    assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true, `${mode}: bounded page`);
    assert.equal(await run('reader.scrollWidth <= reader.clientWidth'), true, `${mode}: bounded reader`);
  }
  const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload(); await loaded; await settle();
  assert.equal(await run('document.documentElement.dataset.theme'), 'review', 'theme survives renderer reload');
  assert.equal(await run('JSON.parse(localStorage.getItem("mdview-preferences")).theme'), 'review');
  assert.equal(menu().getMenuItemById('theme-review').checked, true);
  assert.equal(fs.readFileSync(file, 'utf8'), source, 'theme never writes the document');
  const preview = path.join(app.getPath('userData'), 'review-theme-preview.md');
  fs.writeFileSync(preview, source);
  win.setSize(1280, 900); await openDocument(preview); await settle();
  await run('if(editing) toggleEditing();reader.scrollTop=0'); await settle();
  await checkPalette('#content');
  assert.equal(await run('document.querySelector("#content h1").textContent'), '审阅纸主题');
  const artifacts = path.join(__dirname, '..', 'artifacts'); fs.mkdirSync(artifacts, { recursive: true });
  await fs.promises.writeFile(path.join(artifacts, 'review-theme.png'), (await win.webContents.capturePage()).toPNG());
  console.log('PASS Review paper: menu/settings, bilingual labels, reader/editor/dialog colors, unchanged source/model/selection, narrow layout, reload persistence');
};

if (process.versions.electron && process.argv.some(arg => path.resolve(arg) === __filename)) {
  app.setPath('userData', fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-review-theme-')));
  app.disableHardwareAcceleration();
  const timer = setTimeout(() => { console.error('Review theme timeout'); app.exit(1); }, 90000);
  require('../src/main.cjs').then(async context => {
    try { await module.exports(context); clearTimeout(timer); app.exit(0); }
    catch (error) { console.error(error); app.exit(1); }
  });
}
