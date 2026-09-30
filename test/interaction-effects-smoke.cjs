const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

// Export for the desktop suite. Standalone uses the real main/preload/renderer,
// an isolated profile, and optionally injects only this worker's unwired CSS.
module.exports = async function interactionEffectsSmoke({ win, openDocument, app, inject = false }) {
  const run = code => win.webContents.executeJavaScript(code, true);
  const scratch = await fs.mkdtemp(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-effects-'));
  const fixture = path.join(scratch, 'interaction.md');
  await fs.writeFile(path.join(scratch, 'pixel.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
  await fs.writeFile(fixture, '# Interaction sample\n\nStable reading text.\n\n| A | B |\n|---|---|\n| One | Two |\n\n![pixel](pixel.png){width=120}\n');
  await openDocument(fixture);
  await run('if (!editing) toggleEditing(); toolsCollapsed=false; applyToolsPanel();');
  await delay(180);
  const originalTheme = await run('document.documentElement.dataset.theme');
  const controls = ['#quick-actions button:not(:disabled)', '#tab-bar .tab', '#sidebar-tabs button', '#outline a', '#toggle-outline', '#toggle-editor-tools', '#editor-tools [data-edit="toggleBold"]', '#block-type-trigger'];
  const protectedSelectors = ['#editor-content', '.ProseMirror', '.ProseMirror p', '.ProseMirror table', '.ProseMirror img:not(.ProseMirror-separator)', '.image-resize-handle', '.paragraph-select-menu'];
  const snapshot = selectors => run(`(${JSON.stringify(selectors)}).map(selector=>{const e=document.querySelector(selector);if(!e)return {selector,missing:true};const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {selector,x:r.x,y:r.y,w:r.width,h:r.height,transform:s.transform,perspective:s.perspective,shadow:s.boxShadow}})`);
  const geometry = async () => (await snapshot(controls)).map(({ shadow, ...rect }) => rect);
  const linked = await run("[...document.styleSheets].some(s=>s.href?.endsWith('/interaction-effects.css'))");
  if (linked) await run("[...document.styleSheets].find(s=>s.href?.endsWith('/interaction-effects.css')).disabled=true");
  const before = await geometry(), protectedBefore = await snapshot(protectedSelectors);
  assert.ok(before.every(rect => !rect.missing), 'actual chrome controls exist');
  assert.ok(protectedBefore.every(rect => !rect.missing), 'actual text, image, handles, table and popup exist');
  assert.equal(await run("document.querySelector('.ProseMirror img:not(.ProseMirror-separator)').naturalWidth > 0"), true, 'fixture image decoded');
  let cssKey;
  if (linked) await run("[...document.styleSheets].find(s=>s.href?.endsWith('/interaction-effects.css')).disabled=false");
  else if (inject) cssKey = await win.webContents.insertCSS(await fs.readFile(path.resolve(__dirname, '../src/interaction-effects.css'), 'utf8'));
  else assert.fail('production index must load interaction-effects.css');
  assert.deepEqual(await geometry(), before, 'effects never change target bounds');
  assert.deepEqual(await snapshot(protectedSelectors), protectedBefore, 'document and overlays are untouched');
  const debuggerWasAttached = win.webContents.debugger.isAttached();
  if (!debuggerWasAttached) win.webContents.debugger.attach('1.3');
  const command = (name, args) => win.webContents.debugger.sendCommand(name, args);
  const media = value => command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
  const point = selector => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const move = async selector => { await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await point(selector) }); await delay(180); };
  const state = selector => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),s=getComputedStyle(e),f=e.querySelector('[data-icon],.tab-name');return {shadow:s.boxShadow,transform:s.transform,duration:s.transitionDuration,face:f?getComputedStyle(f).transform:null,focus:e.matches(':focus-visible'),outline:s.outlineStyle,hover:e.matches(':hover')}})()`);
  const selector = '#editor-tools [data-edit="toggleBold"]';
  const colors = [], report = [];
  try {
    await media('no-preference');
    assert.equal(await run("matchMedia('(hover:hover) and (pointer:fine)').matches"), true, 'desktop fine pointer');
    for (const theme of ['light', 'dark', 'warm', 'review']) {
      await run(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await run("document.querySelector('#sidebar-tab-files').click()");
      for (const textSelector of ['#opened-files-list .sidebar-file > .tab-name', '#tab-bar .tab > .tab-name']) {
        await move('.document-header');
        const restingText = await snapshot([textSelector]);
        await move(textSelector);
        assert.equal(await run(`document.querySelector(${JSON.stringify(textSelector)}).matches(':hover')`), true, 'native hover reached filename');
        const hoveredText = await snapshot([textSelector]);
        assert.equal(hoveredText[0].transform, 'none', `${theme}: filename text must not be rasterized through a hover transform`);
        assert.deepEqual(hoveredText, restingText, `${theme}: filename geometry remains stable on hover`);
        await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...await point(textSelector), button: 'left', clickCount: 1 });
        await delay(90);
        assert.equal((await snapshot([textSelector]))[0].transform, 'none', `${theme}: pressed filename text stays untransformed`);
        await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 650, y: 100, buttons: 1 });
        await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 650, y: 100, button: 'left', clickCount: 1 });
      }
      await run("document.querySelector('#sidebar-tab-outline').click()");
      await move('.document-header');
      const rest = await state(selector), bounds = await geometry(), content = await snapshot(protectedSelectors);
      await move(selector);
      const hover = await state(selector);
      assert.equal(hover.hover, true, 'native mouse reached format control');
      assert.notEqual(hover.shadow, rest.shadow, `${theme}: hover has raised depth`);
      assert.notEqual(hover.face, 'none', `${theme}: decorative face has 3D lift`);
      assert.equal(hover.transform, 'none', 'target itself never transforms');
      assert.deepEqual(await geometry(), bounds, 'hover leaves original hitboxes fixed');
      assert.deepEqual(await snapshot(protectedSelectors), content, 'hover leaves document/handles/popovers fixed');
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...await point(selector), button: 'left', clickCount: 1 });
      await delay(90);
      const pressed = await state(selector);
      assert.notEqual(pressed.shadow, hover.shadow, 'press seats the control');
      assert.notEqual(pressed.face, hover.face, 'press brings decorative face back');
      // Release outside so this appearance test does not change the document.
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 650, y: 100, buttons: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 650, y: 100, button: 'left', clickCount: 1 });
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      const focus = await state(selector);
      assert.equal(focus.focus, true, 'keyboard focus is visible');
      assert.equal(focus.outline, 'solid');
      await move(selector);
      const image = win.webContents.isOffscreen() ? await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { win.webContents.removeListener('paint', painted); reject(new Error('interaction paint timeout')); }, 8000);
        const painted = (_event, _dirty, frame) => {
          if (frame.isEmpty()) return;
          clearTimeout(timeout); win.webContents.removeListener('paint', painted); resolve(frame);
        };
        win.webContents.on('paint', painted); win.webContents.invalidate();
      }) : await win.webContents.capturePage();
      assert.equal(image.isEmpty(), false);
      const artifacts = path.resolve(__dirname, '../artifacts/desktop');
      await fs.mkdir(artifacts, { recursive: true });
      await fs.writeFile(path.join(artifacts, `interaction-${theme}.png`), image.toPNG());
      colors.push(await run("getComputedStyle(document.querySelector('#menu-bar')).backgroundColor"));
      report.push({ theme, hover: hover.shadow, pressed: pressed.shadow, focus: focus.focus });
    }
    assert.equal(new Set(colors.slice(0, 3)).size, 3, 'original three chrome palettes preserved');
    assert.equal(report.length, 4, 'filename rendering checked in all four themes');
    win.webContents.send('file-busy', true);
    await delay(100);
    await move(selector);
    let stopped = await state(selector);
    assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).disabled`), true);
    assert.equal(stopped.face, 'none', 'busy disabled control does not move');
    assert.equal(stopped.duration, '0s', 'busy disabled control does not animate');
    win.webContents.send('file-busy', false);
    await delay(100);
    await run("document.body.setAttribute('aria-busy','true')");
    await move(selector);
    stopped = await state(selector);
    assert.equal(stopped.face, 'none', 'busy ancestor suppresses movement');
    assert.equal(stopped.duration, '0s', 'busy ancestor suppresses animation');
    await run("document.body.removeAttribute('aria-busy')");
    await media('reduce');
    await move(selector);
    stopped = await state(selector);
    assert.equal(stopped.face, 'none', 'reduced motion suppresses face movement');
    assert.equal(stopped.duration, '0s', 'reduced motion suppresses transition');
    await media('no-preference');
    await command('Emulation.setTouchEmulationEnabled', { enabled: true });
    assert.equal(await run("matchMedia('(pointer:coarse)').matches"), true);
    await move(selector);
    stopped = await state(selector);
    assert.equal(stopped.face, 'none', 'coarse pointer never lifts');
    assert.equal(stopped.duration, '0s', 'coarse pointer never animates');
    await command('Emulation.setTouchEmulationEnabled', { enabled: false });
    // Open the production top-layer paragraph menu: geometry and hit testing
    // must remain anchored, with no inherited transform/perspective.
    await run("document.querySelector('#block-type-trigger').click()");
    await delay(180);
    assert.equal(await run(`(()=>{const e=document.querySelector('#block-type-listbox'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return e.matches(':popover-open')&&s.transform==='none'&&s.perspective==='none'&&e.contains(document.elementFromPoint(r.x+10,r.y+10))})()`), true, 'top-layer popup is untransformed and hittable');
    await run("document.querySelector('#block-type-listbox').hidePopover()");
    console.log('interaction-effects smoke passed', JSON.stringify({ themes: report, palettes: colors, geometry: 'stable', reducedMotion: true, coarsePointer: true, busy: true }));
  } finally {
    await command('Emulation.setTouchEmulationEnabled', { enabled: false });
    await command('Emulation.setEmulatedMedia', { features: [] });
    if (!debuggerWasAttached) win.webContents.debugger.detach();
    win.webContents.send('file-busy', false);
    await run(`document.body.removeAttribute('aria-busy');document.documentElement.dataset.theme=${JSON.stringify(originalTheme)}`);
    if (cssKey) await win.webContents.removeInsertedCSS(cssKey);
    await fs.rm(scratch, { recursive: true, force: true });
  }
};

if (process.versions.electron && process.argv.some(arg => path.resolve(arg) === __filename)) {
  const { app } = require('electron');
  const fsSync = require('node:fs');
  const profile = fsSync.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-effects-profile-'));
  app.setPath('userData', profile);
  app.disableHardwareAcceleration();
  const timeout = setTimeout(() => { console.error('interaction-effects timeout'); app.exit(1); }, 45000);
  require('../src/main.cjs').then(async context => {
    try {
      assert.ok(context?.win, 'real application started');
      await module.exports({ ...context, app, inject: process.argv.includes('--inject-effects') });
      clearTimeout(timeout);
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
