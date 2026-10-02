const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderEditorHtml, renderMarkdown } = require('../src/markdown.cjs');
const table = '| A | B |\n| :--- | ---: |\n| a | b |';
test('bounded width metadata is applied only to the adjacent matching table', async () => {
  const source = '{table-widths=120,240}\n\n' + table;
  const html = renderEditorHtml(source);
  assert.match(html, /colwidth="120"/);
  assert.match(html, /colwidth="240"/);
  assert.match(html, /width="360"/);
  assert.match(html, /align-left/);
  assert.match(html, /align-right/);
  assert.doesNotMatch(html, /\{table-widths/);
  assert.equal((await renderMarkdown(source)).editorHtml, html);
});
test('invalid widths stay literal; arbitrary HTML remains escaped', () => {
  for (const widths of ['49,240','120,1601','120','120,240,360','120,2.4','120,Infinity','120,240 onclick=x']) {
    const html = renderEditorHtml(`{table-widths=${widths}}\n\n${table}`);
    assert.match(html,/\{table-widths/);
    assert.doesNotMatch(html,/colwidth=/);
  }
  assert.match(renderEditorHtml('```\n{table-widths=120,240}\n```\n\n'+table),/\{table-widths=120,240\}/);
  assert.match(renderEditorHtml('<table onclick="x">'),/&lt;table/);
});
