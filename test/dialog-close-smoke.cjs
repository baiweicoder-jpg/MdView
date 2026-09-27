const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { app } = require('electron');

module.exports = async function dialogCloseSmoke({ win, openDocument }) {
  const run = source => win.webContents.executeJavaScript(source, true);
  const click = async selector => {
    const point = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
    await delay(100);
  };
  const escape = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await delay(100);
  };
  const fixture = path.join(app.getPath('userData'), 'close-fixture.md');
  fs.writeFileSync(fixture, '# Dialogs\n\n```js\nconst example = 1;\n```\n');
  await openDocument(fixture);
  await delay(200);
  for (const language of ['en', 'zh-CN']) {
    await run(`changeLanguage(${JSON.stringify(language)})`);
    await delay(100);
    for (const theme of ['dark', 'warm']) {
      await run(`document.querySelector('#theme').value=${JSON.stringify(theme)};applyTheme()`);
      for (const [dialog, close, open] of [
        ['#settings-dialog', '#close-settings', 'openSettings()'],
        ['#code-dialog', '#close-code-dialog', "openCodeDialog(document.querySelector('#content .expand-code'))"]
      ]) {
        await run(open);
        const control = await run(`(()=>{const e=document.querySelector(${JSON.stringify(close)}),r=e.getBoundingClientRect();return {text:e.textContent.trim(),icon:!!e.querySelector('svg'),name:e.getAttribute('aria-label'),title:e.title,width:r.width,height:r.height}})()`);
        assert.equal(control.text, '');
        assert.equal(control.icon, true);
        assert.equal(control.name, language === 'en' ? 'Close Esc' : '关闭 Esc');
        assert.equal(control.title, control.name);
        assert.equal(control.width, 30);
        assert.equal(control.height, 30);
        await click(close);
        assert.equal(await run(`document.querySelector(${JSON.stringify(dialog)}).open`), false, 'native pointer closes');
        await run(open);
        await escape();
        assert.equal(await run(`document.querySelector(${JSON.stringify(dialog)}).open`), false, 'native Escape closes');
      }
    }
  }
  console.log('Dialog-close smoke passed: both production dialogs, native pointer + Escape, translated accessible X icons, dark/warm, 30px bounds.');
};

if (process.versions.electron && process.argv.some(arg => path.resolve(arg) === __filename)) {
  const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-dialog-close-'));
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  const timeout = setTimeout(() => { console.error('dialog-close timeout'); app.exit(1); }, 45000);
  require('../src/main.cjs').then(async context => {
    try { await module.exports(context); clearTimeout(timeout); app.exit(0); }
    catch (error) { console.error(error); app.exit(1); }
  });
}
