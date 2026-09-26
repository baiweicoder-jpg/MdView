const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { renderMarkdown, readDocument, renderEditorHtml } = require('../src/markdown.cjs');

test('draft editor HTML uses restricted Markdown and inert image sources', () => {
  const html = renderEditorHtml('# DRAFT\n\n==marked== <u>underlined</u>\n\n<script>bad()</script> <img src=x onerror=bad()>\n\n[x](javascript:bad())\n\n![remote](https://example.invalid/image.png) ![local](local.png)');
  assert.match(html, /<h1>DRAFT<\/h1>/);
  assert.match(html, /<mark>marked<\/mark> <u>underlined<\/u>/);
  assert.doesNotMatch(html, /<script|<img src="[^"\s]|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-md-src="https:\/\/example.invalid\/image.png"/);
  assert.match(html, /data-md-src="local.png"/);
  assert.equal((html.match(/<img src=""/g) || []).length, 2);
});

test('renders Markdown, highlighter, unique anchors and table alignment', async () => {
  const result = await renderMarkdown('# 标题\n\n## 标题\n\n## 标题-2\n\n**粗体**\n\n| 左 | 右 |\n| :-- | --: |\n| 1 | 2 |\n\n```js\nconst answer = 42;\n```\n\n```unknown\n<script>unsafe</script>\n```');
  assert.equal(new Set(result.headings.map(h => h.id)).size, 3);
  assert.match(result.html, /<strong>粗体<\/strong>/);
  assert.match(result.html, /class="hljs-keyword"/);
  assert.match(result.html, /class="align-right"/);
  assert.match(result.html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(result.html, /<script>|style=/);
});

test('raw HTML, dangerous links and code language injection remain inert', async () => {
  const result = await renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n```"><img/src=x/onerror=alert(1)>\n<script>alert(1)</script>\n```');
  assert.doesNotMatch(result.html, /<script|<img|href="javascript:/);
  assert.match(result.html, /&lt;script&gt;/);
});

test('both fenced and indented code have independent zoom and copy controls', async () => {
  const result = await renderMarkdown('```js\nconst a = 1;\n```\n\n    <script>plain text</script>\n');
  assert.equal((result.html.match(/class="code-block"/g) || []).length, 2);
  assert.equal((result.html.match(/data-code-zoom="1"/g) || []).length, 2);
  assert.equal((result.html.match(/data-code-zoom="-1"/g) || []).length, 2);
  assert.equal((result.html.match(/class="copy-code"/g) || []).length, 2);
  assert.equal((result.html.match(/class="expand-code"/g) || []).length, 2);
  assert.match(result.html, /&lt;script&gt;plain text&lt;\/script&gt;/);
});

test('scoped highlight and underline preserve formatting but never enable arbitrary HTML', async () => {
  const result = await renderMarkdown('==hello **bold**== <u>safe *text*</u>\n\n`==literal== <u>code</u>`\n\n<u onclick="evil()">bad</u> <script>bad</script>\n\n\\==escaped==');
  assert.match(result.html, /<mark>hello <strong>bold<\/strong><\/mark>/);
  assert.match(result.html, /<u>safe <em>text<\/em><\/u>/);
  assert.match(result.html, /<code>==literal== &lt;u&gt;code&lt;\/u&gt;<\/code>/);
  assert.doesNotMatch(result.html, /<u onclick|<script/);
});

test('controlled colors preserve nested inline marks while invalid attributes stay inert', async () => {
  const result = await renderMarkdown('<mark data-color="#AABBCC">one **bold** <span data-color="#123456">ink</span> <mark data-color="#112233">inner</mark> end</mark>\n\n<span data-color="red">bad</span> <mark data-color="#fff" onclick="evil()">bad</mark>\n\n`<span data-color="#123456">code</span>`');
  assert.match(result.html, /<mark data-color="#aabbcc">one <strong>bold<\/strong> <span data-color="#123456">ink<\/span> <mark data-color="#112233">inner<\/mark> end<\/mark>/);
  assert.doesNotMatch(result.html, /<span data-color="red"|<mark data-color="#fff"|style=/);
  assert.match(result.html, /&lt;span data-color=&quot;red&quot;&gt;/);
  assert.match(result.html, /<code>&lt;span/);
});

test('color scopes allow inline line breaks but not arbitrary HTML forms', async () => {
  const result = await renderMarkdown('<span data-color="#123456">first  \nsecond</span>\n\n<span data-color=\'#123456\'>single quote</span>\n\n<mark data-color="#123456" style="color:red">extra attr</mark>\n\n<span data-color="#123">short</span>\n\n\\<span data-color="#123456">escaped</span>');
  assert.match(result.html, /<span data-color="#123456">first<br>\nsecond<\/span>/);
  assert.equal((result.html.match(/<span data-color=/g) || []).length, 1);
  assert.doesNotMatch(result.html, /<mark/);
});

test('task checkboxes preserve nested and mixed list structure without enabling input HTML', async () => {
  const result = await renderMarkdown('- [ ] Todo\n- [X] Done\n  - [x] Nested\n- Plain\n\n<input type="checkbox" checked>');
  assert.equal((result.html.match(/data-type="taskItem"/g) || []).length, 3);
  assert.equal((result.html.match(/data-checked="true"/g) || []).length, 2);
  assert.equal((result.html.match(/type="checkbox" disabled/g) || []).length, 3);
  assert.match(result.editorHtml, /data-type="taskList"/);
  assert.match(result.html, /<li>Plain<\/li>/);
  assert.match(result.html, /&lt;input/);
});

test('scoped marks leave escapes and multiline delimiters literal', async () => {
  const result = await renderMarkdown(String.raw`==one\==two==` + '\n\n==line\nbreak==\n\n<u>line\nbreak</u>');
  assert.match(result.html, /<mark>one==two<\/mark>/);
  assert.doesNotMatch(result.html, /<mark>line|<u>line/);
});

test('loads Unicode and space paths, bounds image access and document size', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdview-test-'));
  // Fixtures are deliberately retained in the OS temporary directory for inspection.
  const directory = path.join(root, '中文 文档');
  await fs.mkdir(directory);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(path.join(directory, '空 格.png'), png);
  await fs.writeFile(path.join(root, 'outside.png'), png);
  const doc = path.join(directory, '测试.md');
  await fs.writeFile(doc, '\uFEFF# 中文\n\n![正常](空%20格.png)\n\n![越界](../outside.png)\n\n![网络](https://example.com/image.png)\n\n![缺失](missing.png)');
  const result = await readDocument(doc);
  assert.equal(result.headings[0].title, '中文');
  assert.match(result.html, /src="data:image\/png;base64,/);
  assert.match(result.html, /图片未加载：越界/);
  assert.match(result.html, /图片未加载：网络/);
  assert.equal((result.html.match(/<img /g) || []).length, 1);
  assert.equal(result.warnings.length, 1);
  await assert.rejects(readDocument(path.join(root, 'outside.png')), /请选择/);
  const large = path.join(directory, 'large.md');
  await fs.writeFile(large, Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(readDocument(large), /文件过大/);
});
