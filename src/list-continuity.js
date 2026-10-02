import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

// PM lift/split copies list attrs verbatim to both fragments. A middle-item
// Backspace therefore makes the right fragment restart at 1 (or 0/5). Repair
// only fragments proven by transaction mapping to come from ONE original list;
// never join/renumber independent user-authored lists or coerce an explicit 0.
export function orderedListContinuityPlugin() {
  return new Plugin({
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some(tr => tr.docChanged)) return;
      const mapping = new Mapping();
      for (const tr of transactions) mapping.appendMapping(tr.mapping);
      const tr = state.tr;
      oldState.doc.descendants((list, pos) => {
        if (list.type.name !== 'orderedList') return;
        const depth = oldState.doc.resolve(pos + 1).depth;
        const fragments = new Map();
        list.forEach((item, offset) => {
          // listItem starts with a paragraph; its content anchor survives a lift.
          const mapped = mapping.mapResult(pos + offset + 3, 1);
          if (mapped.deleted || mapped.pos > state.doc.content.size) return;
          const $pos = state.doc.resolve(mapped.pos);
          if ($pos.depth < depth + 2 || $pos.node(depth).type.name !== 'orderedList'
            || $pos.node(depth + 1).type.name !== 'listItem') return;
          fragments.set($pos.before(depth), $pos.node(depth));
        });
        if (fragments.size < 2) return;
        const ordered = [...fragments].sort((a,b)=>a[0]-b[0]);
        const start = list.attrs.start ?? 1;
        // Explicit start edits in the same operation remain authoritative.
        if (ordered.some(([,node]) => node.attrs.start !== start || node.attrs.type !== list.attrs.type)) return;
        let next = start;
        for (const [at, node] of ordered) {
          if (node.attrs.start !== next) tr.setNodeMarkup(at, undefined, { ...node.attrs, start: next });
          next += node.childCount;
        }
      });
      return tr.docChanged ? tr : undefined;
    },
  });
}
export const OrderedListContinuity = Extension.create({
  name: 'orderedListContinuity',
  addProseMirrorPlugins: () => [orderedListContinuityPlugin()],
});
