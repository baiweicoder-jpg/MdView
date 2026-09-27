const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
test('scoped native wheel zoom and fresh-process preferences', { timeout: 120000 }, () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-zoom-restart-'));
  const env = { ...process.env, MDVIEW_ZOOM_PROFILE_ROOT: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const args of [[], ['--verify-restored']]) {
      const result = spawnSync(require('electron'), [path.join(__dirname, 'zoom-controls-electron.cjs'), ...args], { env, encoding: 'utf8', timeout: 55000 });
      assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
      console.log(result.stdout.trim());
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
