const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
test('tab filename native UI, file actions and fresh-process renamed path recovery', {timeout:120000}, () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-tab-restart-'));
  try {
    for (const phase of ['write','read']) {
      const result = spawnSync(require('electron'), [path.join(__dirname,'tab-context-electron.cjs')], {cwd:path.join(__dirname,'..'),encoding:'utf8',timeout:55000,env:{...process.env,MDVIEW_TAB_DIR:dir,MDVIEW_TAB_PHASE:phase}});
      assert.equal(result.status,0,`${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout,/TAB CONTEXT .*PASS/); console.log(result.stdout);
    }
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
