import { Mark, Extension, markInputRule, markPasteRule } from '@tiptap/core';
import { TaskList, TaskItem, OrderedList, ListItem, getListMarker } from '@tiptap/extension-list';
import { renderNestedMarkdownContent } from '@tiptap/core';

// Upstream 3.31 uses `start || 1` in both Markdown paths, losing explicit
// zero starts. Keep PM's start attribute (not prosemirror-schema-list's order).
export const MarkdownOrderedList = OrderedList.extend({
  markdownTokenizer: {
    ...OrderedList.config.markdownTokenizer,
    tokenize(source, tokens, lexer) {
      const token = OrderedList.config.markdownTokenizer.tokenize(source, tokens, lexer);
      if (token && /^\s*0+[.)]\s/.test(source)) token.start = 0;
      return token;
    },
  },
  parseMarkdown(token, helpers) {
    const parsed = OrderedList.config.parseMarkdown(token, helpers);
    if (parsed && !Array.isArray(parsed) && token.start === 0) parsed.attrs = { ...parsed.attrs, start: 0 };
    return parsed;
  },
});
export const MarkdownListItem = ListItem.extend({
  renderMarkdown(node, helpers, context) {
    // CommonMark cannot interrupt a paragraph with an ordered start other
    // than 1. Without this blank boundary the reader turns nested 0/5 into prose.
    const nested = { ...helpers, renderChild(child, index) {
      const rendered = helpers.renderChild(child, index);
      return child.type === 'orderedList' && (child.attrs?.start ?? 1) !== 1 ? '\n' + rendered : rendered;
    } };
    return renderNestedMarkdownContent(node, nested, ctx => {
      if (ctx.parentType !== 'orderedList') return '- ';
      const start = ctx.meta?.parentAttrs?.start ?? 1;
      return getListMarker(ctx.meta?.parentAttrs?.type, start - 1 + (ctx.index ?? 0), '. ');
    }, context, { alignNestedToPrefix: context?.parentType === 'orderedList' });
  },
});
import Underline from '@tiptap/extension-underline';

// Tiptap 3.31 handles text before extension renderMarkdown handlers and only
// calls mark renderers with a placeholder to discover their wrappers. Use the
// public serialize(JSON) API: protect literal equals in a detached text tree,
// then escape only those protected characters, never generated mark delimiters.
export function serializeMarkdown(manager, doc) {
  let placeholder = '\uE000MDVIEWEQUALS\uE001';
  const json = JSON.stringify(doc);
  while (json.includes(placeholder)) placeholder = placeholder.replace('\uE001', 'X\uE001');
  function protect(node, inCode = false) {
    const code = inCode || node.type === 'codeBlock' || node.marks?.some(mark => mark.type === 'code');
    return {
      ...node,
      // Escape singles too: they can otherwise join a neighbouring == wrapper.
      ...(node.type === 'text' && !code ? { text: node.text.replace(/=/g, placeholder) } : {}),
      ...(node.content ? { content: node.content.map(child => protect(child, code)) } : {}),
    };
  }
  return manager.serialize(protect(doc)).split(placeholder).join('\\=');
}

export const validColor = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : null;
const colorAttributes = () => ({ color: {
  default: null,
  parseHTML: element => validColor(element.getAttribute('data-color')),
  renderHTML: attrs => validColor(attrs.color) ? { 'data-color': validColor(attrs.color) } : {},
} });
// CSSOM property writes work under style-src 'self'; emitted Markdown never
// contains style attributes. The reader applies the same properties at runtime.
function colorDOM(tag, color) {
  const dom = document.createElement(tag);
  if (validColor(color)) {
    dom.setAttribute('data-color', validColor(color));
    dom.style[tag === 'mark' ? 'backgroundColor' : 'color'] = validColor(color);
  }
  return { dom, contentDOM: dom };
}

function colorToken(src, lexer, tag, type) {
  const opening = new RegExp(`^<${tag} data-color="(#[\\da-fA-F]{6})">`).exec(src);
  if (!opening) return;
  const stack = [tag];
  for (let end = opening[0].length; end < src.length; end++) {
    if (/^\n[ \t]*\n/.test(src.slice(end))) return;
    if (src[end] === '\\') { end++; continue; }
    if (src[end] === '`') {
      const ticks = /^`+/.exec(src.slice(end))[0];
      const closing = src.indexOf(ticks, end + ticks.length);
      if (closing >= 0) { end = closing + ticks.length - 1; continue; }
    }
    const nested = /^<(mark|span) data-color="#[\da-fA-F]{6}">/.exec(src.slice(end));
    if (nested) { stack.push(nested[1]); end += nested[0].length - 1; continue; }
    const closing = /^<\/(mark|span)>/.exec(src.slice(end));
    if (closing && closing[1] === stack.at(-1)) {
      stack.pop();
      if (!stack.length) return { type, raw: src.slice(0, end + closing[0].length), color: validColor(opening[1]), tokens: lexer.inlineTokens(src.slice(opening[0].length, end)) };
      end += closing[0].length - 1;
    }
  }
}

// These are scoped Markdown extensions, not a switch that enables arbitrary HTML.
export const MarkdownHighlight = Mark.create({
  name: 'highlight',
  addAttributes: colorAttributes,
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: ({ HTMLAttributes }) => ['mark', HTMLAttributes, 0],
  addMarkView: () => ({ mark }) => colorDOM('mark', mark.attrs.color),
  addCommands() {
    return {
      toggleHighlight: () => ({ commands }) => commands.toggleMark(this.name),
      setHighlightColor: color => ({ commands }) => !!validColor(color) && commands.setMark(this.name, { color: validColor(color) }),
      unsetHighlight: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(==(?!\s)([^=\n]+)==)$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /==(?!\s)([^=\n]+)==/g, type: this.type })];
  },
  parseMarkdown: (token, h) => h.applyMark('highlight', h.parseInline(token.tokens || []), { color: validColor(token.color) }),
  renderMarkdown: (node, h) => validColor(node.attrs?.color) ? `<mark data-color="${validColor(node.attrs.color)}">${h.renderChildren(node)}</mark>` : `==${h.renderChildren(node)}==`,
  markdownTokenizer: {
    name: 'highlight', level: 'inline',
    start: src => [src.indexOf('=='), src.indexOf('<mark data-color="')].filter(n => n >= 0).sort((a, b) => a - b)[0] ?? -1,
    tokenize(src, _tokens, lexer) {
      const colored = colorToken(src, lexer, 'mark', 'highlight');
      if (colored) return colored;
      const match = /^==((?:\\.|[^\n])+?)==/.exec(src);
      if (match) return { type: 'highlight', raw: match[0], tokens: lexer.inlineTokens(match[1]) };
    },
  },
});

export const MarkdownTextColor = Mark.create({
  name: 'textColor',
  addAttributes: colorAttributes,
  parseHTML: () => [{ tag: 'span[data-color]', getAttrs: element => validColor(element.getAttribute('data-color')) ? {} : false }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
  addMarkView: () => ({ mark }) => colorDOM('span', mark.attrs.color),
  addCommands() {
    return {
      setTextColor: color => ({ commands }) => !!validColor(color) && commands.setMark(this.name, { color: validColor(color) }),
      unsetTextColor: () => ({ commands }) => commands.unsetMark(this.name),
    };
  },
  parseMarkdown: (token, h) => h.applyMark('textColor', h.parseInline(token.tokens || []), { color: validColor(token.color) }),
  renderMarkdown: (node, h) => validColor(node.attrs?.color) ? `<span data-color="${validColor(node.attrs.color)}">${h.renderChildren(node)}</span>` : h.renderChildren(node),
  markdownTokenizer: {
    name: 'textColor', level: 'inline',
    start: src => src.indexOf('<span data-color="'),
    tokenize: (src, _tokens, lexer) => colorToken(src, lexer, 'span', 'textColor'),
  },
});

// StarterKit's built-in underline uses ++text++; use explicit <u> instead.
export const MarkdownUnderline = Underline.extend({
  renderMarkdown: (node, h) => `<u>${h.renderChildren(node)}</u>`,
  markdownTokenizer: {
    name: 'underline', level: 'inline',
    start: src => src.indexOf('<u>'),
    tokenize(src, _tokens, lexer) {
      const match = /^<u>([^\n]+?)<\/u>/.exec(src);
      if (match) return { type: 'underline', raw: match[0], tokens: lexer.inlineTokens(match[1]) };
    },
  },
});

// GFM permits plain and task items in the same list. Retain plain siblings.
export const MarkdownTaskList = TaskList.extend({ content: '(taskItem | listItem)+' });
export const MarkdownTaskItem = TaskItem.extend({
  renderMarkdown(node, helpers) {
    // Match MarkdownListItem's structural boundary without changing task
    // prefixes, checked state, marks, or the upstream nesting indentation.
    const nested = { ...helpers, renderChild(child, index) {
      const rendered = helpers.renderChild(child, index);
      return child.type === 'orderedList' && (child.attrs?.start ?? 1) !== 1 ? '\n' + rendered : rendered;
    } };
    return TaskItem.config.renderMarkdown(node, nested);
  },
}).configure({ nested: true });
export const InsertDate = Extension.create({
  name: 'insertDate',
  addCommands() {
    return {
      insertDate: () => ({ commands }) => {
        const date = new Date();
        const text = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        return commands.insertContent({ type: 'text', text });
      },
    };
  },
});
export const markdownEditingExtensions = [MarkdownOrderedList, MarkdownListItem, MarkdownHighlight, MarkdownTextColor, MarkdownUnderline, MarkdownTaskList, MarkdownTaskItem, InsertDate];
