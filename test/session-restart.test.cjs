const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
test('Save As rejects an open destination before disk write and still permits recovery/exit', {timeout:30000}, async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-save-blocker-'));
  try {
    const env = {...process.env, MDVIEW_SESSION_TEST_DIR:dir, MDVIEW_SESSION_PHASE:'collision'};
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [path.join(__dirname,'close-save-blockers-electron.cjs')], {env,encoding:'utf8',timeout:25000,windowsHide:true});
    assert.equal(result.status,0,`${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout,/BLOCKER collision PASS/);
    const disk = JSON.parse(fs.readFileSync(path.join(dir,'profile','session.json'),'utf8'));
    const { restoreWorkspace } = require('../src/workspace-session.cjs');
    const { readDocument } = require('../src/markdown.cjs');
    const restored = await restoreWorkspace(disk, null, readDocument);
    assert.equal(restored.documents.length, 3);
    assert.equal(restored.documents.at(-1).path, '');
    assert.equal(restored.documents.at(-1).source, 'independent source draft');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('last tab closes to an empty workspace and permits real Electron exit', {timeout:30000}, () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-close-blocker-'));
  try {
    const env = {...process.env, MDVIEW_SESSION_TEST_DIR:dir, MDVIEW_SESSION_PHASE:'empty'};
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [path.join(__dirname,'close-save-blockers-electron.cjs')], {env,encoding:'utf8',timeout:25000,windowsHide:true});
    assert.equal(result.status,0,`${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout,/BLOCKER empty PASS/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('untitled Unicode drafts survive real process exit; cancel, discard, save and failed recovery remain safe', {timeout:60000}, () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-draft-restart-'));
  try {
    for (const phase of ['draft-write','draft-read']) {
      const env = {...process.env,MDVIEW_SESSION_TEST_DIR:dir,MDVIEW_SESSION_PHASE:phase};
      delete env.ELECTRON_RUN_AS_NODE;
      const result = spawnSync(require('electron'),[path.join(__dirname,'draft-electron.cjs')],{env,encoding:'utf8',timeout:25000,windowsHide:true});
      assert.equal(result.status,0,`${phase}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout,new RegExp(`SESSION ${phase} PASS`));
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('real Electron exit and separate process restart restores ordered tabs, active tab and CLI dedup', {timeout:90000}, () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-electron-session-'));
  try {
    // Long enough to test real Chromium scroll restoration, not just stored metadata.
    fs.writeFileSync(path.join(dir,'a.md'),'# Original A' + '\n\nA restart scroll fixture paragraph.'.repeat(160));
    fs.writeFileSync(path.join(dir,'b.md'),'# Original B');
    for (const phase of ['write','read','cli','missing','corrupt','blank','save','saved','close','closed']) {
      const sessionFile = path.join(dir,'profile','session.json');
      if (phase === 'missing') {
        fs.unlinkSync(path.join(dir,'b.md'));
        const saved = JSON.parse(fs.readFileSync(sessionFile,'utf8'));
        saved.activeIndex = 1;
        const bad = path.join(dir,'invalid.md');
        fs.writeFileSync(bad,Buffer.from([0xff,0xfe,0xfd]));
        saved.tabs.push({path:bad},{path:path.join(dir,'directory.md')});
        fs.mkdirSync(path.join(dir,'directory.md'));
        fs.writeFileSync(sessionFile,JSON.stringify(saved));
      }
      if (phase === 'corrupt') fs.writeFileSync(sessionFile,'{broken');
      if (phase === 'blank') fs.writeFileSync(sessionFile,JSON.stringify({version:1,tabs:[{path:'',source:'DO NOT RECOVER',viewState:{editing:true,scrollTop:0}}],activeIndex:0}));
      const env = {...process.env,MDVIEW_SESSION_TEST_DIR:dir,MDVIEW_SESSION_PHASE:phase};
      delete env.ELECTRON_RUN_AS_NODE;
      const args = [path.join(__dirname,'session-electron.cjs')];
      if (phase === 'cli') args.push(path.join(dir,'b.md'));
      const result = spawnSync(require('electron'),args,{env,encoding:'utf8',timeout:25000,windowsHide:true});
      assert.equal(result.status,0,`${phase}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout,new RegExp(`SESSION ${phase} PASS`));
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
