const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { statTimes } = require('../src/document-times.cjs');
test('unsupported birthtime never falls back to ctime; invalid values remain unknown', () => {
  const now = Date.now();
  for (const birthtimeMs of [undefined, null, 0, -1, Infinity, NaN, '2026-01-01', 8640000000000001]) {
    assert.deepEqual(statTimes({ birthtimeMs, mtimeMs: now, ctimeMs: now }), { createdAt: null, updatedAt: now });
  }
});
const { validateSession, restoreWorkspace } = require('../src/workspace-session.cjs');
test('optional draft times survive recovery; legacy and invalid times remain unknown', async () => {
  const now = Date.now();
  const tabs = [{ path: '', source: 'draft', createdAt: now, updatedAt: now }, { path: '', source: 'legacy' }, { path: '', source: '', createdAt: 'yesterday', updatedAt: -1 }];
  const value = { version: 2, tabs, activeIndex: 0 };
  const valid = validateSession(value);
  assert.equal(valid.tabs[0].createdAt, now);
  assert.ok(!valid.tabs[1].createdAt);
  assert.ok(!valid.tabs[2].updatedAt);
  const restored = await restoreWorkspace(value, null, () => assert.fail('draft disk read'));
  assert.equal(restored.documents[0].updatedAt, now);
});

const { readTextFile, saveTextFile } = require('../src/document-file.cjs');

test('file metadata matches actual stat on open, save, Save As and external reload', async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-times-'));
  try {
    const file = path.join(dir, 'source.md'), destination = path.join(dir, 'destination.md');
    await fs.writeFile(file, '# source');
    async function matches(document, target) {
      const stat = await fs.stat(target);
      assert.equal(document.createdAt, stat.birthtimeMs > 0 ? stat.birthtimeMs : null);
      assert.equal(document.updatedAt, stat.mtimeMs);
    }
    const opened = await readTextFile(file); await matches(opened, file);
    const saved = await saveTextFile(file, '# edited', { expectedHash: opened.fingerprint }); await matches(saved, file);
    const copy = await saveTextFile(destination, saved.source, { expectedHash: null }); await matches(copy, destination);
    await fs.utimes(file, new Date(), new Date(Date.now() - 60000));
    await matches(await readTextFile(file), file);
    assert.equal(await fs.readFile(destination, 'utf8'), '# edited');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
