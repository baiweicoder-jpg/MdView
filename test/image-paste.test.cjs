const { registerImagePaste, validateEmbeddedPng, normalizePng, MAX_PNG, MAX_INPUT } = require('../src/image-paste.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../src/markdown.cjs');
test('IPC accepts throwing-validator trusted contract used by main', () => {
  let handler;
  const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.from(PNG, 'base64') };
  registerImagePaste(() => {}, { ipcMain: { handle: (_channel, fn) => { handler = fn; } }, nativeImage: { createFromBuffer: () => image } });
  assert.equal(handler({}, new Uint8Array(Buffer.from(PNG, 'base64'))).ok, true);
});
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
test('rejects dangerous MIME, noncanonical base64, oversized input and PNG dimensions before decode', async () => {
  const url = `data:image/png;base64,${PNG}`;
  for (const bad of [url.replace('image/png','image/svg+xml'), url.replace('base64,','charset=utf8;base64,'), url + '=', url.replace('iVBOR','iVB%4FR'), 'data:image/png;base64,PHN2Zz48L3N2Zz4=', url + '\n']) assert.throws(() => validateEmbeddedPng(bad));
  assert.throws(() => validateEmbeddedPng('data:image/png;base64,' + Buffer.alloc(MAX_PNG + 1).toString('base64')));
  let decodes = 0;
  const decoder = { createFromBuffer() { decodes++; throw Error('should not decode'); } };
  for (const bytes of [new Uint8Array(MAX_INPUT + 1), [256], [-1], [1.5], 'url', Buffer.from('<svg/>')]) assert.throws(() => normalizePng(bytes, decoder));
  const huge = Buffer.from(PNG, 'base64'); huge.writeUInt32BE(9000, 16);
  assert.throws(() => normalizePng(huge, decoder));
  assert.equal(decodes, 0);
  await assert.rejects(renderMarkdown('x'.repeat(10 * 1024 * 1024 + 1)));
  for (const bad of ['data:image/svg+xml;base64,PHN2Zy8+', 'https://invalid.example/image.png', 'data:image/png;base64,YmFk']) {
    const rendered = await renderMarkdown(`![bad](${bad})`);
    assert.doesNotMatch(rendered.html, /<img/);
  }
});
test('decoded size, empty native image and output size are independently bounded', () => {
  const input = Buffer.from(PNG, 'base64');
  for (const image of [
    { isEmpty: () => true },
    { isEmpty: () => false, getSize: () => ({ width: 8192, height: 8192 }) },
    { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => Buffer.alloc(MAX_PNG + 1) }
  ]) assert.throws(() => normalizePng(input, { createFromBuffer: () => image }));
});
test('untrusted sender never decodes', () => {
  let handler;
  registerImagePaste(() => false, { ipcMain: { handle: (_channel, fn) => { handler = fn; } }, nativeImage: { createFromBuffer() { assert.fail('untrusted decode'); } } });
  assert.equal(handler({}, Buffer.from(PNG, 'base64')).ok, false);
});
test('embedded PNG renders without a document directory', async () => {
  const url = `data:image/png;base64,${PNG}`;
  const rendered = await renderMarkdown(`![screenshot](${url})`);
  assert.equal(rendered.assets[url], url);
  assert.match(rendered.html, /<img/);
  assert.equal(rendered.warnings.length, 0);
});
