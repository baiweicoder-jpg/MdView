const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {renderEditorHtml, createMarkdownParser} = require('../src/markdown-parser.cjs');
const production = require('../src/markdown.cjs');
// Load the real browser module with its installed dependencies, not a mock.
const Module = require('node:module');
const built = require('esbuild').buildSync({entryPoints:[path.join(__dirname,'../src/markdown-paste.js')],bundle:true,write:false,platform:'node',format:'cjs'}).outputFiles[0].text;
const compiled = new Module(path.join(__dirname,'markdown-paste-bundle.cjs'), module);
compiled.filename = path.join(__dirname,'markdown-paste-bundle.cjs');
compiled.paths = module.paths; compiled._compile(built, compiled.filename);
const {looksLikeMarkdown} = compiled.exports;

// Includes reader-only owners, all custom marks, nested/loose lists, aligned
// tables, both code renderers, width bounds and approved/rejected image forms.
const consolidationSource = [
  '# 重复', '# 重复',
  '**bold** *em* ~~strike~~ ==mark **nested**== <u>under</u>',
  '<mark data-color="#AABBCC">outer <span data-color="#123456">ink</span></mark>',
  '- [x] done\n  - nested\n- [ ]\n- &#32;\n- plain',
  '- loose\n\n  second\n\n- [ ] task',
  '1. ordered\n2. next',
  '| left | center | right |\n| :--- | :---: | ---: |\n| a | b | c |',
  '```js\nconst answer = 42;\n```',
  '```unknown\n<script>literal</script>\n```',
  '    ==indented== <u>literal</u>',
  '[safe](https://example.com) [bad](javascript:bad())',
  '<script>bad()</script> <u onclick="bad()">bad</u> <span style="color:red">bad</span>',
  'before ![local](relative.png "title"){width=32} ![remote](https://example.invalid/a.png){width=1600} after',
  '![invalid](relative.png){width=31} ![invalid](relative.png){width=1601}',
  '![embedded](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=){width=240}',
  '![bad data](data:image/png;base64,AAAA)',
  'first  \nsecond\nthird',
].join('\n\n');

test('consolidation preserves the pre-refactor rendered payload byte for byte', async()=>{
  const result = await production.renderMarkdown(consolidationSource);
  const payload = {result, editor: production.renderEditorHtml(consolidationSource), search: production.searchTextBlocks(consolidationSource)};
  // Recorded from the pre-consolidation production module, not the shared parser.
  assert.equal(require('node:crypto').createHash('sha256').update(JSON.stringify(payload)).digest('hex'), '31874e91b4499a2cb4ee01e7a2eb0863ce95b27397c59429bbd8f2cda852a28e');
  assert.equal(renderEditorHtml(consolidationSource), payload.editor);
  assert.match(result.html, /data-search-inline="true"/);
  assert.doesNotMatch(payload.editor, /data-search-inline|data-search-image/);
  assert.match(result.html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(payload.editor, /<img[^>]*\ssrc="[^"\s]/);
  assert.match(result.html, /class="hljs-keyword"/);
  for (const control of ['collapse-code', 'wrap-code', 'expand-code', 'copy-code', 'code-zoom-reset']) assert.match(result.html, new RegExp(`class="${control}"`));
});

test('production reader, editor, search and clipboard own separate mutable parsers', async()=>{
  const shared = require('../src/markdown-parser.cjs');
  const instances = [];
  const filename = path.join(__dirname, '../src/markdown.cjs');
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = module.paths;
  const originalRequire = isolated.require.bind(isolated);
  isolated.require = id => id === './markdown-parser.cjs' ? {...shared, createMarkdownParser() {
    const parser = shared.createMarkdownParser();
    instances.push(parser);
    return parser;
  }} : originalRequire(id);
  isolated._compile(fs.readFileSync(filename, 'utf8'), filename);
  assert.equal(instances.length, 3);
  assert.equal(new Set([...instances, shared.md]).size, 4);
  const api = isolated.exports;
  const expected = await api.renderMarkdown(consolidationSource);
  const editor = api.renderEditorHtml(consolidationSource);
  const search = api.searchTextBlocks(consolidationSource);
  const paste = renderEditorHtml(consolidationSource);
  // Only the reader instance handles reader render calls. Real rule overrides
  // would corrupt reconstruction/search if those consumers shared its state.
  instances[0].renderer.rules.fence = () => 'reader-only';
  instances[0].disable('highlight');
  assert.notEqual((await api.renderMarkdown(consolidationSource)).html, expected.html);
  assert.equal(api.renderEditorHtml(consolidationSource), editor);
  assert.deepEqual(api.searchTextBlocks(consolidationSource), search);
  assert.equal(renderEditorHtml(consolidationSource), paste);
  instances[1].renderer.rules.fence = () => 'editor-only';
  assert.notEqual(api.renderEditorHtml(consolidationSource), editor);
  assert.deepEqual(api.searchTextBlocks(consolidationSource), search);
  assert.equal(renderEditorHtml(consolidationSource), paste);
  instances[2].disable('highlight');
  assert.notDeepEqual(api.searchTextBlocks(consolidationSource), search);
  assert.equal(renderEditorHtml(consolidationSource), paste);
  // Reader-only token rewrites never survive into subsequent calls/documents.
  assert.deepEqual(await production.renderMarkdown(consolidationSource), expected);
  assert.equal(production.renderEditorHtml(consolidationSource), editor);
});

test('recognizable source markers, not ordinary prose or standalone URLs',()=>{
  for(const text of ['## 中文标题','```text\n代码\n```','~~~\n代码\n~~~','**加粗**','__加粗__','==高亮==','<u>下划线</u>','<span data-color="#123456">颜色</span>','1. 开始\n2. 结束','- 一级\n  - 子项','| A | B |\n| --- | :---: |\n| C | D |','[链接](https://example.com)']) assert.equal(looksLikeMarkdown(text),true,text);
  for(const text of ['普通中文段落','hello\nworld','https://example.com','1. 单独编号说明','价格 1 * 2','C# language','\\# escaped heading']) assert.equal(looksLikeMarkdown(text),false,text);
});

test('reader delegates restricted rules to the browser-safe shared factory',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../src/markdown.cjs'),'utf8');
  assert.match(source, /require\('\.\/markdown-parser\.cjs'\)/);
  assert.doesNotMatch(source, /new MarkdownIt|\.ruler\.|renderer\.rules/);
});

test('shared factory isolates renderer rules and parser options between consumers',()=>{
  assert.equal(typeof createMarkdownParser, 'function');
  const reader = createMarkdownParser();
  const editor = createMarkdownParser();
  const paste = createMarkdownParser();
  const search = createMarkdownParser();
  const text = '- [x] ==marked== <u>under</u>\n\n```js\nconst n = 1;\n```';
  const expected = editor.render(text);
  for (const parser of [editor, paste, search]) {
    assert.notEqual(reader.renderer.rules, parser.renderer.rules);
    assert.notEqual(reader.options, parser.options);
    assert.notEqual(reader.inline.ruler, parser.inline.ruler);
    assert.equal(parser.render(text), expected);
  }
  reader.renderer.rules.list_item_open = () => 'reader-only';
  reader.renderer.rules.fence = () => 'reader-code';
  reader.options.html = true;
  reader.disable('highlight');
  for (const parser of [editor, paste, search]) {
    assert.equal(parser.render(text), expected);
    assert.equal(parser.options.html, false);
    assert.doesNotMatch(parser.render('<script>bad()</script>'), /<script>/);
  }
  assert.equal(createMarkdownParser().render(text), expected);
});

test('browser and main editor output retain exact custom syntax parity',()=>{
  for(const text of ['## 章节\n\n**粗体**\n\n1. 一\n   - 子项\n2. 二','- [ ] 检查\n- [x] 完成','==高亮== <u>下划线</u> <span data-color="#123456">颜色</span>','![图](relative.png){width=240}','```text\n链接：@url:`https://pan.baidu.com/s/xxxxxx`\n提取码：abcd\n```','| 名称 | 值 |\n| --- | ---: |\n| 甲 | 乙 |','## 安全\n\n<script>alert(1)</script>\n[坏](javascript:alert(1))']) assert.equal(renderEditorHtml(text),production.renderEditorHtml(text));
});
