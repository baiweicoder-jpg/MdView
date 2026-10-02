// Shared restricted rules for reader, editor, clipboard and search.
// No filesystem, IPC or network access. Each consumer owns its mutable parser.
const MarkdownIt = require('markdown-it');
const hljs = require('highlight.js/lib/common');
const { installWidthSyntax } = require('./table-width-syntax.cjs');

function createMarkdownParser() {
const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return ''; // The renderer escapes unknown/unlabelled languages.
  }
});
// A single bounded suffix immediately after an image; not arbitrary attributes/HTML.
md.inline.ruler.before('text', 'image_width', (state, silent) => {
  const image = state.tokens.at(-1);
  if (state.pending || image?.type !== 'image' || image.attrGet('width')) return false;
  const match = /^\{width=([1-9]\d{1,3})\}/.exec(state.src.slice(state.pos, state.posMax));
  if (!match || Number(match[1]) < 32 || Number(match[1]) > 1600) return false;
  if (!silent) image.attrSet('width', match[1]);
  state.pos += match[0].length;
  return true;
});
// Explicit inline syntax only; raw HTML remains disabled, including attributes on <u>.
for (const [name, tag, open, close] of [['highlight', 'mark', '==', '=='], ['underline', 'u', '<u>', '</u>']]) {
  md.inline.ruler.before('emphasis', name, (state, silent) => {
    const start = state.pos;
    if (!state.src.startsWith(open, start) || state.level >= state.md.options.maxNesting) return false;
    let end = start + open.length;
    for (; end < state.posMax; end++) {
      if (state.src[end] === '\n') return false;
      if (state.src[end] === '\\') { end++; continue; }
      if (state.src.startsWith(close, end)) break;
    }
    if (end >= state.posMax || end === start + open.length) return false;
    if (!silent) {
      state.push(`${name}_open`, tag, 1);
      const previousMax = state.posMax;
      state.pos = start + open.length;
      state.posMax = end;
      state.md.inline.tokenize(state);
      state.posMax = previousMax;
      state.push(`${name}_close`, tag, -1);
    }
    state.pos = end + close.length;
    return true;
  });
}
// Only this exact, double-quoted six-digit syntax is markup. No raw HTML.
md.inline.ruler.before('emphasis', 'controlled_color', (state, silent) => {
  const start = state.pos;
  const opening = /^<(mark|span) data-color="(#[\da-fA-F]{6})">/.exec(state.src.slice(start, state.posMax));
  if (!opening || state.level >= state.md.options.maxNesting) return false;
  const stack = [opening[1]];
  let end = start + opening[0].length;
  for (; end < state.posMax; end++) {
    if (state.src[end] === '\\') { end++; continue; }
    if (state.src[end] === '`') {
      const ticks = /^`+/.exec(state.src.slice(end))[0];
      const closing = state.src.indexOf(ticks, end + ticks.length);
      if (closing >= 0 && closing < state.posMax) { end = closing + ticks.length - 1; continue; }
    }
    const nested = /^<(mark|span) data-color="#[\da-fA-F]{6}">/.exec(state.src.slice(end));
    if (nested) { stack.push(nested[1]); end += nested[0].length - 1; continue; }
    const closing = /^<\/(mark|span)>/.exec(state.src.slice(end));
    if (closing && closing[1] === stack.at(-1)) {
      stack.pop();
      if (!stack.length) break;
      end += closing[0].length - 1;
    }
  }
  if (stack.length || end === start + opening[0].length) return false;
  if (!silent) {
    state.push('controlled_color_open', opening[1], 1).attrSet('data-color', opening[2].toLowerCase());
    const previousMax = state.posMax;
    state.pos = start + opening[0].length;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = previousMax;
    state.push('controlled_color_close', opening[1], -1);
  }
  state.pos = end + opening[1].length + 3;
  return true;
});
// Work on parsed list tokens, never source replacement (which would alter code).
md.core.ruler.after('inline', 'task_lists', state => {
  const lists = [];
  const items = [];
  for (let i = 0; i < state.tokens.length; i++) {
    const token = state.tokens[i];
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') lists.push(token);
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') lists.pop();
    if (token.type === 'list_item_open') items.push(token);
    if (token.type === 'list_item_close') {
      const item = items.pop();
      if (item?.attrGet('data-type') === 'taskItem') token.meta = { task: true };
    }
    if (token.type !== 'inline' || state.tokens[i - 1]?.type !== 'paragraph_open' || state.tokens[i - 2] !== items.at(-1)) continue;
    const marker = /^\[([ xX])\](?:[ \t]+|$)/.exec(token.content);
    const list = lists.at(-1);
    if (!marker || list?.type !== 'bullet_list_open') continue;
    const checked = marker[1].toLowerCase() === 'x';
    list.attrSet('data-type', 'taskList');
    items.at(-1).attrSet('data-type', 'taskItem');
    items.at(-1).attrSet('data-checked', String(checked));
    token.content = token.content.slice(marker[0].length);
    token.children = [];
    state.md.inline.parse(token.content, state.md, state.env, token.children);
  }
});
md.renderer.rules.list_item_open = (tokens, i, options, _env, self) => {
  const token = tokens[i];
  const opening = self.renderToken(tokens, i, options);
  if (token.attrGet('data-type') !== 'taskItem') return opening;
  return opening + `<label><input type="checkbox" disabled${token.attrGet('data-checked') === 'true' ? ' checked' : ''} aria-label="${md.utils.escapeHtml(tokens[i + 2]?.content || 'Task')}"></label><div>`;
};
md.renderer.rules.list_item_close = (tokens, i) => `${tokens[i].meta?.task ? '</div>' : ''}</li>\n`;
for (const type of ['th_open', 'td_open']) {
  md.renderer.rules[type] = (tokens, index, _options, _env, self) => {
    const token = tokens[index];
    const align = token.attrGet('style');
    if (align) {
      token.attrs = token.attrs.filter(([name]) => name !== 'style');
      token.attrSet('class', `align-${align.split(':')[1]}`);
    }
    return self.renderToken(tokens, index, {});
  };
}
for (const type of ['fence', 'code_block']) {
  const render = md.renderer.rules[type];
  md.renderer.rules[type] = (tokens, index, options, env, self) => {
    const language = tokens[index].info.trim().split(/\s+/)[0] || 'text';
    return `<section class="code-block"><div class="code-toolbar"><span class="code-language">${md.utils.escapeHtml(language)}</span><div class="code-actions"><button type="button" class="collapse-code" aria-expanded="true" title="折叠 / Collapse code">折叠 / Fold</button><button type="button" class="wrap-code" aria-pressed="false" title="自动换行 / Wrap long lines">换行 / Wrap</button><button type="button" data-code-zoom="-1" aria-label="缩小此代码块字号" title="缩小代码字号">A−</button><button type="button" data-code-zoom="0" class="code-zoom-reset" aria-label="恢复此代码块默认字号" title="恢复默认字号">100%</button><button type="button" data-code-zoom="1" aria-label="放大此代码块字号" title="放大代码字号">A＋</button><button class="expand-code" type="button" aria-label="单独查看此代码块" aria-haspopup="dialog">单独查看</button><button class="copy-code" type="button" aria-label="复制代码">复制</button></div></div>${render(tokens, index, options, env, self)}</section>`;
  };
}

installWidthSyntax(md);
return md;
}

// Retain the browser entry's exports; main-process consumers create their own
// instances rather than sharing this clipboard renderer's mutable rules.
const md = createMarkdownParser();

function renderEditorHtml(source, parser = md) {
  const tokens = parser.parse(source, {});
  for (const token of tokens) for (const child of token.children || []) {
    if (child.type !== 'image') continue;
    child.attrSet('data-md-src', child.attrGet('src') || '');
    child.attrSet('src', '');
  }
  return parser.renderer.render(tokens, parser.options, {});
}

module.exports = { createMarkdownParser, md, renderEditorHtml };
