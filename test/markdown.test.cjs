const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { renderMarkdown, readDocument } = require('../src/markdown.cjs');

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
