const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('production Electron keeps the active outline live without replacing the editor', { timeout: 90000 }, () => {
  const cwd = path.resolve(__dirname, '..');
  const build = spawnSync(process.execPath, ['scripts/build.cjs'], { cwd, encoding: 'utf8', timeout: 30000 });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [path.join(__dirname, 'live-outline-electron.cjs')], {
    cwd, env, encoding: 'utf8', timeout: 60000, windowsHide: true
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /LIVE OUTLINE PASS/);
});
