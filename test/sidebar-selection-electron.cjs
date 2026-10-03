// Isolated native modifier-input regression + synthetic visual evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { app } = electron;
// Force only this test's production-created windows hidden/offscreen from construction.
// backgroundThrottling must be false at construction so hidden requestAnimationFrame runs.
const NativeWindow = electron.BrowserWindow;
const Module = require('node:module');
const load = Module._load;
const testElectron = { ...electron, BrowserWindow: class extends NativeWindow {
  constructor(options) { super({ ...options, show: false, webPreferences: { ...options.webPreferences, backgroundThrottling: false, offscreen: true } }); }
} };
Module._load = function(request, ...args) { return request === 'electron' ? testElectron : load.call(this, request, ...args); };
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || 'I:/AI/Hermes/cache/scratch', 'mdview-sidebar-ui-'));
const names = ['产品设计说明', '交互规范', '项目计划', '会议记录'];
const files = names.map(name => path.join(dir, `${name}.md`));
files.forEach((file, index) => fs.writeFileSync(file, `# ${names[index]}\n\n让信息清晰，让阅读专注。此文档为界面验证使用的合成内容。\n\n## 设计目标\n\n保持紧凑的导航与清晰的文档层级，让常用操作触手可及。\n\n- 单击文件名称，打开文档\n- Ctrl 多选，Shift 连续选择\n- 文档内容始终是工作区的中心\n\n## 实施计划\n\n按阶段完成设计评审、开发验证与交付。\n\n> 批量操作仅在选择文件后出现。\n`));
fs.mkdirSync(path.join(dir, 'profile'));
fs.writeFileSync(path.join(dir, 'profile/session.json'), JSON.stringify({ version: 2, tabs: files.map(file => ({ path: file, viewState: { editing: false, scrollTop: 0 } })), activeIndex: 0 }));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('browser-window-created', (_, win) => { win.hide(); win.setSkipTaskbar(true); win.webContents.setBackgroundThrottling(false); });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => { console.error('Sidebar native watchdog timeout'); app.exit(1); }, 60000);
console.log('Sidebar synthetic fixture:', dir);
(async () => {
  const { win } = await require('../src/main.cjs');
  Module._load = load;
  win.hide(); win.webContents.setBackgroundThrottling(false); win.setMinimumSize(0, 0); win.setContentSize(1280, 800);
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i = 0; i < 240; i++) { if (await run(code)) return; await delay(25); } assert.fail(code + ' STATE ' + JSON.stringify(await run('({name:currentDocument?.name,count:tabs.length,restoringView,notice:document.querySelector("#notice").textContent})'))); };
  await wait('!!currentDocument && !restoringView && tabs.length === 4');
  await run('document.querySelector("#sidebar-tab-files").click()');
  win.webContents.debugger.attach('1.3');
  const mouse = async (index, modifiers = 0, hover = false) => {
    const point = await run(`(() => { const r = document.querySelectorAll('.sidebar-file')[${index}].getBoundingClientRect(); return {x:r.x+50,y:r.y+r.height/2}; })()`);
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type:'mouseMoved', ...point, modifiers});
    if (!hover) for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {type,...point,modifiers,button:'left',clickCount:1});
    await delay(100);
  };
  const selected = () => run('document.querySelectorAll(".sidebar-file-entry.selected").length');
  const screenshot = async name => { await delay(100); fs.writeFileSync(path.join(dir, name + '.png'), Buffer.from((await win.webContents.debugger.sendCommand('Page.captureScreenshot', {format:'png', captureBeyondViewport:false})).data, 'base64')); };
  assert.equal(await selected(), 0);
  assert.equal(await run('document.querySelectorAll("#opened-files-list input").length'), 0, 'no empty checkbox in DOM');
  assert.equal(await run('getComputedStyle(document.querySelector("#opened-files-actions")).display'), 'none');
  await screenshot('light-1280-default');
  await run('document.querySelectorAll(".sidebar-file")[0].focus()');
  for (const type of ['keyDown','keyUp']) win.webContents.sendInputEvent({ type, keyCode:'Down', modifiers:['shift'] });
  await delay(100);
  assert.deepEqual(await run('[...document.querySelectorAll(".sidebar-file")].map((n,i)=>n.getAttribute("aria-pressed")==="true"?i:-1).filter(i=>i>=0)'), [0,1], 'initial keyboard focus includes origin without Ctrl Space');
  await run('document.querySelector("#opened-files-clear").click()');
  await mouse(1, 0, true); await screenshot('light-1280-hover');
  assert.equal(await run('[...document.querySelectorAll(".sidebar-file-mark")].every(n=>!n.textContent && getComputedStyle(n).borderStyle === "none")'), true);
  await mouse(1); await wait('currentDocument.name === "交互规范.md" && !restoringView'); assert.equal(await selected(), 0, 'plain filename opens only');
  const labelX = await run('document.querySelectorAll(".sidebar-file .tab-name")[1].getBoundingClientRect().x');
  await mouse(1, 2); assert.equal(await selected(), 1, 'native Ctrl left click toggles');
  await mouse(3, 8); assert.equal(await selected(), 3, 'native Shift left click selects range');
  assert.equal(await run('currentDocument.name'), '交互规范.md', 'modifiers do not navigate');
  assert.equal(await run('document.querySelectorAll(".sidebar-file .tab-name")[1].getBoundingClientRect().x'), labelX, 'no filename shift');
  assert.equal(await run('[...document.querySelectorAll(".sidebar-file-entry")].every(n => n.querySelector(".sidebar-file-mark").textContent === (n.classList.contains("selected") ? "✓" : ""))'), true);
  await screenshot('light-1280-selected');
  await mouse(1, 2); assert.equal(await selected(), 2, 'Ctrl removes selection');
  await mouse(0); await wait('currentDocument.name === "产品设计说明.md" && !restoringView'); assert.equal(await selected(), 0, 'normal navigation clears pending batch safely');
  await mouse(2, 8); assert.equal(await selected(), 3, 'normal navigation anchors following range');
  await mouse(0); assert.equal(await selected(), 0, 'normal active click also clears');
  await run('document.querySelectorAll(".sidebar-file")[0].focus()');
  for (const type of ['keyDown','keyUp']) win.webContents.sendInputEvent({ type, keyCode:'Space', modifiers:['control'] });
  await delay(100); assert.equal(await selected(), 1, 'native Ctrl Space');
  for (const type of ['keyDown','keyUp']) win.webContents.sendInputEvent({ type, keyCode:'Down', modifiers:['shift'] });
  await delay(100); assert.equal(await selected(), 2, 'native Shift Down');
  for (const type of ['keyDown','keyUp']) win.webContents.sendInputEvent({ type, keyCode:'Escape' });
  await delay(100); assert.equal(await selected(), 0, 'Escape clears');
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await delay(100);
  };
  const expectRows = async (indices, label) => assert.deepEqual(await run('[...document.querySelectorAll(".sidebar-file")].map((n,i)=>n.getAttribute("aria-pressed")==="true"?i:-1).filter(i=>i>=0)'), indices, label);
  await run('document.querySelectorAll(".sidebar-file")[0].focus()');
  await key('Escape'); await key('Down', ['shift']);
  await expectRows([0,1], 'Escape then Shift Down includes focused origin');
  await key('Down', ['shift']); await expectRows([0,1,2], 'repeated Shift Down extends');
  await key('Up', ['shift']); await expectRows([0,1], 'Shift Up shrinks keyboard range');
  await key('Down'); await key('Down', ['shift']);
  await expectRows([2,3], 'normal arrow resets anchor to newly focused row');
  await run('document.querySelector("#opened-files-clear").click();document.querySelectorAll(".sidebar-file")[1].focus()');
  await key('Down', ['shift']); await expectRows([1,2], 'Clear then keyboard focus needs no Ctrl Space');
  await run('document.querySelector("#opened-files-clear").click();document.querySelectorAll(".sidebar-file")[0].focus()');
  await key('End', ['shift']); await expectRows([0,1,2,3], 'Shift End includes origin');
  await key('Home', ['shift']); await expectRows([0], 'Shift Home shrinks to anchor');
  await run('document.querySelector("#opened-files-search").value="规范";document.querySelector("#opened-files-search").dispatchEvent(new Event("input"));document.querySelector(".sidebar-file").focus()');
  await key('Down', ['shift']); await expectRows([0], 'filtered range excludes hidden IDs and stale anchor');
  assert.equal(await selected(), 1);
  assert.equal(await run('document.querySelector("#opened-files-count").textContent.includes("1")'), true);
  assert.equal(await run('currentDocument.name'), '产品设计说明.md', 'keyboard navigation never opens files');
  await run('document.querySelector("#opened-files-search").value="";document.querySelector("#opened-files-search").dispatchEvent(new Event("input"));document.querySelector("#opened-files-clear").click()');
  for (const theme of ['light', 'dark', 'warm', 'review', 'sky']) {
    await run(`document.querySelector("#theme").value=${JSON.stringify(theme)}; applyTheme()`);
    for (const width of [1280, 700, 460]) {
      win.setContentSize(width, 800); await delay(150);
      await run('document.querySelector("#opened-files-clear").click()');
      await screenshot(`${theme}-${width}-default`);
      await mouse(0, 2); await mouse(2, 8);
      await screenshot(`${theme}-${width}-selected`);
      assert.equal(await run('document.documentElement.scrollWidth <= innerWidth'), true, `${theme} ${width} no page overflow`);
    }
  }
  win.webContents.debugger.detach();
  console.log('SIDEBAR SELECTION PASS: native click/Ctrl/Shift, normal-clear anchor, no hover checkbox, fixed label position, CtrlSpace/ShiftDown/Escape; 5 themes x 3 widths. Screenshots: ' + dir);
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
