const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {app} = require('electron');
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || app.getPath('temp'), 'mdview-insert-table-'));
app.setPath('userData', path.join(dir, 'profile'));
app.disableHardwareAcceleration();
app.on('browser-window-created', (_event, win) => { win.hide(); win.setSkipTaskbar(true); win.webContents.setBackgroundThrottling(false); });
(async () => {
  const {win} = await require('../src/main.cjs');
  // Disable throttling on the loaded renderer as well as the native window.
  win.webContents.setBackgroundThrottling(false);
  const run = code => win.webContents.executeJavaScript(code, true);
  const wait = async code => { for (let i=0;i<240;i++) { if(await run(code)) return; await new Promise(r=>setTimeout(r,25)); } assert.fail(code); };
  await wait('!!currentDocument && !restoringView');
  await run('window.mdview.newDocument()');
  await wait('editing && !restoringView && !!richEditor');
  assert.equal(await run('!!document.querySelector("#insert-table-rows")'), true, 'initial table creation offers row count');
  assert.equal(await run('$("#insert-table-rows").value'), '3', 'existing default remains three rows');
  for (const amount of ['0', '101', '1.5', '-1', '']) {
    await run(`$('#insert-table-rows').value=${JSON.stringify(amount)};document.querySelector('[data-edit="table"]').click()`);
    assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("table").length'), 0, 'invalid amount rejected '+amount);
    assert.equal(await run('$("#insert-table-rows").getAttribute("aria-invalid")'), 'true');
  }
  for (const amount of [1, 7, 100]) {
    await run(`richEditor.editor.commands.setContent('<p>before</p><p></p><p>after</p>');richEditor.editor.commands.setTextSelection(9);$('#insert-table-rows').focus();$('#insert-table-rows').value='${amount}';document.querySelector('[data-edit="table"]').click()`);
    await wait(`richEditor.editor.view.dom.querySelectorAll('tr').length===${amount}`);
    assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("th").length'), 3, 'three columns and one header');
    assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("th,td").length'), amount*3);
    assert.match(await run('richEditor.editor.getText()'), /before[\s\S]*after/);
    assert.equal(await run('$("#insert-table-rows").hasAttribute("aria-invalid")'), false);
    await run('richEditor.editor.commands.undo()');
    assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("table").length'), 0, 'one undo removes inserted table');
    await run('richEditor.editor.commands.redo()');
    assert.equal(await run('richEditor.editor.view.dom.querySelectorAll("tr").length'), amount, 'redo restores row count');
  }
  console.log('INSERT TABLE PASS: initial 1/7/100 rows, default 3 columns/header, invalid rejection, selection, undo/redo');
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
