const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readTextFile, saveTextFile, MAX_DOCUMENT } = require('../src/document-file.cjs');

test('save preserves UTF-8 BOM and CRLF, and round-trips Unicode paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mdview-save-'));
  const file = path.join(directory, '编辑 文档.md');
  await fs.writeFile(file, '\uFEFF# 初始\r\n\r\n正文\r\n');
  const before = await readTextFile(file);
  assert.equal(before.bom, true);
  assert.equal(before.newline, '\r\n');
  await saveTextFile(file, '# 修改\n\n**内容**\n', { expectedHash: before.fingerprint, bom: before.bom, newline: before.newline });
  assert.equal(await fs.readFile(file, 'utf8'), '\uFEFF# 修改\r\n\r\n**内容**\r\n');
  assert.notEqual((await readTextFile(file)).fingerprint, before.fingerprint);
});

test('save refuses external changes, unexpected existing files and deleted originals', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mdview-conflict-'));
  const file = path.join(directory, 'conflict.md');
  await fs.writeFile(file, 'original');
  const before = await readTextFile(file);
  await fs.writeFile(file, 'external change');
  await assert.rejects(saveTextFile(file, 'my draft', { expectedHash: before.fingerprint }), { code: 'FILE_CHANGED' });
  await assert.rejects(saveTextFile(file, 'new file', { expectedHash: null }), { code: 'FILE_CHANGED' });
  assert.equal(await fs.readFile(file, 'utf8'), 'external change');
  await assert.rejects(saveTextFile(path.join(directory, 'missing.md'), 'draft', { expectedHash: before.fingerprint }), { code: 'FILE_CHANGED' });
});

test('new files are saved; invalid UTF-8, oversized content and non-Markdown paths are rejected', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mdview-validation-'));
  const file = path.join(directory, 'new.markdown');
  await saveTextFile(file, '# 新文档', { expectedHash: null });
  const before = await readTextFile(file);
  await assert.rejects(saveTextFile(file, 'x'.repeat(MAX_DOCUMENT + 1), { expectedHash: before.fingerprint }), /文件过大/);
  assert.equal((await readTextFile(file)).source, '# 新文档');
  await assert.rejects(saveTextFile(path.join(directory, 'bad.exe'), 'draft', { expectedHash: null }), /请选择/);
  const invalid = path.join(directory, 'invalid.md');
  await fs.writeFile(invalid, Buffer.from([0xff, 0xfe, 0x61]));
  await assert.rejects(readTextFile(invalid), /UTF-8/);
});
