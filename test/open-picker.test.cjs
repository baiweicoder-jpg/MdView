const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
test('native picker defaults and multi-open preserve real documents through close/restart', {timeout:120000}, () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-picker-restart-'));
  try {
    for (const phase of ['write', 'read']) {
      const result = spawnSync(require('electron'), [path.join(__dirname, 'open-picker-electron.cjs')], {
        cwd:path.join(__dirname, '..'), encoding:'utf8', timeout:55000,
        env:{...process.env, MDVIEW_PICKER_DIR:dir, MDVIEW_PICKER_PHASE:phase},
      });
      assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      assert.ok(result.stdout.includes(`OPEN PICKER ${phase} PASS`), result.stdout);
      console.log(result.stdout);
    }
  } finally { fs.rmSync(dir, { recursive:true, force:true, maxRetries:5, retryDelay:200 }); }
});
