const { test } = require('node:test');
const assert = require('node:assert/strict');
test('content search finds literal Unicode and repeated matches across inline formatting and code', () => {
  const { searchSource } = require('../src/content-search-core.cjs');
  const result = searchSource('# 你好 **世界**\n\n你好 世界 你好 世界\n\n```js\n你好 世界\n```', '你好 世界');
  assert.equal(result.total, 4);
  assert.deepEqual(result.hits.map(h => [h.block, h.from, h.to]), [[0,0,5],[1,0,5],[1,6,11],[2,0,5]]);
 });
test('literal matching, Unicode case folding and bounded honest counts', () => {
  const { searchSource } = require('../src/content-search-core.cjs');
  assert.equal(searchSource('`A.*[x] a.*[x]`', '.*[x]').total, 2);
  assert.equal(searchSource('İ x Ä ä Σ σ ς 😀😀', 'ä').total, 2);
  assert.equal(searchSource('Ä ä', 'ä', true).total, 1);
  assert.deepEqual(searchSource('İ x 😀😀', 'x').hits.map(h=>[h.from,h.to]), [[2,3]]);
  assert.deepEqual(searchSource('😀😀', '😀').hits.map(h=>[h.from,h.to]), [[0,2],[2,4]]);
  assert.equal(searchSource('aaa', 'aa').total, 1, 'matches do not overlap');
  assert.deepEqual(searchSource('abc', ''), {total:0,hits:[]});
  const result = searchSource('word '.repeat(1200), 'word');
  assert.equal(result.total,1200); assert.equal(result.hits.length,500);
  assert.equal(searchSource('word '.repeat(1200), 'word',false,0).total,1200);
  assert.equal(searchSource('word '.repeat(1200), 'word',false,0).hits.length,0);
});
test('production Markdown extensions, lists, table cells, images and breaks share block coordinates', () => {
 const {searchTextBlocks} = require('../src/markdown.cjs');
 assert.deepEqual(searchTextBlocks(`- [x] ==needle==
- <u>needle</u>

| h |
|---|
| \`needle\` |

a ![needle](missing.png){width=240} needle
soft\x20\x20
hard`), ['needle','needle','h','needle','a \ufffc needle soft\nhard']);
});
test('reader list ownership follows hidden paragraph tokens, not rendered whitespace', async () => {
 const {renderMarkdown, renderEditorHtml, searchTextBlocks} = require('../src/markdown.cjs');
 const cases = [
   ['- first\n  - child\n  # heading\n  needle', ['first','child','heading','needle'], 3],
   ['- &nbsp;&#32;&#10;needle', ['\u00a0 \nneedle'], 1],
   ['- [x] needle', ['needle'], 1],
   ['- [x] needle\n\n  continuation', ['needle','continuation'], 0],
   ['- # heading\n  needle', ['heading','needle'], 1],
   ['- ```text\n  code\n  ```\n  needle', ['code','needle'], 1],
   ['- first\n  # heading\n  needle', ['first','heading','needle'], 2],
   ['- first\n  - # heading\n    needle', ['first','heading','needle'], 2],
   ['- [x] first\n  # heading\n  needle', ['first','heading','needle'], 2],
   ['- &nbsp;\n- needle', ['\u00a0','needle'], 2],
   ['- &#32;\n- needle', [' ','needle'], 2],
   ['- &#10;\n- needle', ['\n','needle'], 2],
   ['- &#10;\n  - needle', ['\n','needle'], 2],
   ['-\n- needle', ['needle'], 1],
   ['- # needle', ['needle'], 0],
   ['- ```text\n  needle\n  ```', ['needle'], 0],
   ['-\n  - needle', ['needle'], 1],
   ['- &nbsp;\n\n- needle', ['\u00a0','needle'], 0],
   ['- [ ]\n  - needle', ['','needle'], 2],
   ['- [ ]\n\n  - needle', ['','needle'], 1],
   ['- [ ]\n\n  needle', ['','needle'], 0],
   ['- parent\n  - [ ]\n\n  - needle', ['parent','','needle'], 1],
 ];
 for (const [source, blocks, owners] of cases) {
   const rendered = await renderMarkdown(source);
   assert.deepEqual(searchTextBlocks(source), blocks, source);
   assert.equal((rendered.html.match(/ data-search-inline="true"/g) || []).length, owners, source);
   assert.equal(rendered.html.replace(/<span data-search-inline="true">([\s\S]*?)<\/span>/g, '$1'), rendered.editorHtml, 'only reader ownership metadata differs');
   // Document previews add outline IDs; draft reconstruction intentionally does not.
   assert.equal(rendered.editorHtml.replace(/ id="[^"]*"/g, ''), renderEditorHtml(source), 'editor reconstruction is unchanged');
 }
});
test('obsolete worker jobs terminate; next query runs independently', async () => {
 const service = require('../src/content-search-service.cjs')();
 try {
   const old = service.search({source:'x '.repeat(5*1024*1024),query:'x',limit:500});
   service.cancel();
   assert.equal(await old,null);
   const result = await service.search({source:'fresh fresh',query:'fresh',limit:500});
   assert.equal(result.total,2);
 } finally { service.cancel(); }
});
test('10 MB scan keeps the caller responsive and 100 sequential tab jobs stay bounded', async () => {
 const service = require('../src/content-search-service.cjs')();
 let ticks = 0;
 const heartbeat = setInterval(() => ticks++, 5);
 try {
   const source = '```text\n' + 'x '.repeat((10 * 1024 * 1024 - 12) / 2) + '\n```';
   assert.equal(Buffer.byteLength(source),10 * 1024 * 1024);
   const result = await service.search({source,query:'x',limit:500});
   assert.equal(result.total,(10 * 1024 * 1024 - 12) / 2);
   assert.equal(result.hits.length,500);
   assert.ok(ticks > 2,'matching/parsing must not block the caller event loop');
   let total = 0, shown = 0;
   for(let i=0;i<100;i++) {
     const result = await service.search({source:'tab match '.repeat(8),query:'match',limit:Math.max(0,500-shown)});
     total += result.total; shown += result.hits.length;
   }
   assert.equal(total,800); assert.equal(shown,500);
 } finally { clearInterval(heartbeat); service.cancel(); }
});
