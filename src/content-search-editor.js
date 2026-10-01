import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
const key = new PluginKey('documentSearch');
export function installContentSearch(editor) {
  editor.registerPlugin(new Plugin({
    key,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, previous) {
        const marks = tr.getMeta(key);
        if (marks) return DecorationSet.create(tr.doc, marks);
        // Do not retain stale coordinates between a keystroke and the debounced query.
        return tr.docChanged ? DecorationSet.empty : previous;
      },
    },
    props: { decorations: state => key.getState(state) },
  }));
  return (hits, selected, query = '', caseSensitive = false) => {
    if (editor.isDestroyed) return [];
    if (!hits.length) {
      if (key.getState(editor.state).find().length) editor.view.dispatch(editor.state.tr.setMeta(key, []).setMeta('addToHistory', false));
      return [];
    }
    const blocks = [];
    editor.state.doc.descendants((node, pos, parent) => {
      if (node.isTextblock) {
        // Blank standalone paragraphs disappear from Markdown; table cells do not.
        let blank = node.type.name === 'paragraph' && /^[ \t\r\n]*$/.test(node.textContent);
        node.forEach(child => { if (!child.isText) blank = false; });
        if (!blank || ['tableCell', 'tableHeader'].includes(parent.type.name)) blocks.push({ node, pos: pos + 1 });
        return false;
      }
    });
    const positions = new Map();
    const mapped = hits.map(hit => {
      const block = blocks[hit.block];
      if (!block || !query) return null;
      if (!positions.has(hit.block)) {
        let text = '';
        block.node.forEach(node => { text += node.isText ? node.text : node.type.name === 'hardBreak' ? '\n' : '\ufffc'; });
        const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'gu' : 'giu');
        const matches = [];
        for (let match; matches.length < 500 && (match = pattern.exec(text));) matches.push({ from: block.pos + match.index, to: block.pos + match.index + match[0].length });
        positions.set(hit.block, matches);
      }
      return positions.get(hit.block)[hit.ordinal] || null;
    });
    const marks = mapped.flatMap((range, i) => range ? [Decoration.inline(range.from, range.to, { class: i === selected ? 'document-search-match document-search-selected' : 'document-search-match' })] : []);
    editor.view.dispatch(editor.state.tr.setMeta(key, marks).setMeta('addToHistory', false));
    return mapped;
  };
}
