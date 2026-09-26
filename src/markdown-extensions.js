import { Mark, Extension, markInputRule, markPasteRule } from '@tiptap/core';
import { TaskList, TaskItem } from '@tiptap/extension-list';
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

// These are scoped Markdown extensions, not a switch that enables arbitrary HTML.
export const MarkdownHighlight = Mark.create({
  name: 'highlight',
  parseHTML: () => [{ tag: 'mark' }],
  renderHTML: () => ['mark', 0],
  addCommands() {
    return { toggleHighlight: () => ({ commands }) => commands.toggleMark(this.name) };
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(==(?!\s)([^=\n]+)==)$/, type: this.type })];
  },
  addPasteRules() {
    return [markPasteRule({ find: /==(?!\s)([^=\n]+)==/g, type: this.type })];
  },
  parseMarkdown: (token, h) => h.applyMark('highlight', h.parseInline(token.tokens || [])),
  renderMarkdown: (node, h) => `==${h.renderChildren(node)}==`,
  markdownTokenizer: {
    name: 'highlight', level: 'inline',
    start: src => src.indexOf('=='),
    tokenize(src, _tokens, lexer) {
      const match = /^==((?:\\.|[^\n])+?)==/.exec(src);
      if (match) return { type: 'highlight', raw: match[0], tokens: lexer.inlineTokens(match[1]) };
    },
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
export const MarkdownTaskItem = TaskItem.configure({ nested: true });
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
export const markdownEditingExtensions = [MarkdownHighlight, MarkdownUnderline, MarkdownTaskList, MarkdownTaskItem, InsertDate];
