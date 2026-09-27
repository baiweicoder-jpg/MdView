const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const files = require('../src/document-file.cjs');
test('Windows filename boundary rejects reserved, traversal, ambiguous and unsupported names', () => {
  for (const name of ['', ' ', '.', '..', '.md', '../a.md', 'C:\\a.md', '/tmp/a.md', 'a/b.md', 'a\\b.md', 'a:stream.md', 'a?.md', 'a*.md', 'a<.md', 'a>.md', 'a|.md', 'a".md', 'a\0.md', 'a.md ', 'a.md.', 'CON.md', 'con .md', 'PRN.markdown', 'LPT1.md', 'COM¹.md', 'a.txt', 'x'.repeat(256)+'.md']) {
    assert.throws(() => files.validateFilename(name), undefined, name);
  }
  for (const name of ['中文 space.md','normal.MD','normal.markdown','a.b.md']) assert.equal(files.validateFilename(name),name);
});
test('rename refuses collisions, external changes and missing sources without destructive writes', async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(),'mdview-rename-errors-'));
  try {
    const old = path.join(root,'first.md'), target=path.join(root,'exists.md');
    await fs.writeFile(old,'# original'); await fs.writeFile(target,'# destination');
    const doc=await files.readTextFile(old);
    await assert.rejects(files.renameTextFile(doc,'exists.md'), {code:'EEXIST'});
    assert.equal(await fs.readFile(target,'utf8'),'# destination'); assert.equal(await fs.readFile(old,'utf8'),'# original');
    if(process.platform==='win32') await assert.rejects(files.renameTextFile(doc,'FIRST.md'), /大小写/);
    assert.equal((await files.renameTextFile(doc,'first.md')).path,old);
    await fs.writeFile(old,'# external');
    await assert.rejects(files.renameTextFile(doc,'new.md'), /其他程序/);
    await assert.rejects(fs.stat(path.join(root,'new.md')), {code:'ENOENT'});
    await fs.unlink(old); await assert.rejects(files.renameTextFile(doc,'new.md'), {code:'ENOENT'});
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
test('read-only source is rejected without creating another name', async () => {
  const root=await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(),'mdview-rename-readonly-'));
  const old=path.join(root,'locked.md'), target=path.join(root,'other.md');
  try {
    await fs.writeFile(old,'read only'); const doc=await files.readTextFile(old);
    await fs.chmod(old,0o444);
    await assert.rejects(files.renameTextFile(doc,'other.md'));
    assert.equal(await fs.readFile(old,'utf8'),'read only');
    await assert.rejects(fs.stat(target),{code:'ENOENT'});
  } finally { await fs.chmod(old,0o666).catch(()=>{}); await fs.rm(root,{recursive:true,force:true}); }
});
test('rename moves disk bytes without saving the draft', async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR || os.tmpdir(), 'mdview-rename-'));
  try {
    const old = path.join(root, 'original.md');
    await fs.writeFile(old, '\ufeff# disk\r\n![relative](image.png)\r\n');
    const doc = await files.readTextFile(old);
    assert.equal(typeof files.renameTextFile, 'function', 'filesystem rename API exists');
    const result = await files.renameTextFile(doc, '中文 new.markdown');
    assert.equal(result.path, path.join(root, '中文 new.markdown'));
    assert.equal((await files.readTextFile(result.path)).fingerprint, doc.fingerprint);
    await assert.rejects(fs.stat(old), {code:'ENOENT'});
  } finally { await fs.rm(root, {recursive:true, force:true}); }
});
