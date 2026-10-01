// Plan against the live model; never normalize serialized Markdown or protected nodes.
const { closeHistory } = require('@tiptap/pm/history');
function planCleanup(state, kind, selection = state.selection) {
  const scoped = selection && !selection.empty;
  const from = scoped ? selection.from : 0, to = scoped ? selection.to : state.doc.content.size;
  const edits = [];
  const add = (a, b, text = '') => { if (a >= from && b <= to && b > a) edits.push({ from: a, to: b, text }); };
  const prose = node => {
    if (node.type.name !== 'paragraph') return false;
    let safe = true;
    node.forEach(child => { if (!child.isText || child.marks.some(mark => ['code', 'link'].includes(mark.type.name))) safe = false; });
    return safe;
  };
  let previous;
  state.doc.forEach((node, pos) => {
    if (kind === 'lines' && previous && prose(previous.node) && prose(node) && previous.node.textContent.trim() && node.textContent.trim()) {
      const left = previous.node.textContent.slice(-1), right = node.textContent[0];
      // Separate English/numeric tokens. CJK-to-CJK boundaries need no space.
      const bothCjk = /[\u3400-\u9fff]/u.test(left) && /[\u3400-\u9fff]/u.test(right);
      add(pos - 1, pos + 1, /\s/u.test(left + right) || bothCjk ? '' : ' ');
    }
    previous = { node, pos };
    if (node.type.name !== 'paragraph') return;
    if (kind === 'blank' && prose(node) && /^[ \t]*$/.test(node.textContent)) add(pos, pos + node.nodeSize);
    if (kind === 'spaces') {
      let text = '', protectedRanges = [], protectedIndex = 0;
      node.forEach(child => {
        const value = child.isText ? child.text : '\ufffc';
        if (!child.isText || child.marks.some(mark => mark.type.name === 'code' || mark.type.name === 'link')) protectedRanges.push({ from: text.length, to: text.length + value.length });
        text += value;
      });
      for (const match of text.matchAll(/ +/g)) {
        const a = match.index, b = a + match[0].length;
        while (protectedRanges[protectedIndex]?.to <= a) protectedIndex++;
        if (protectedRanges[protectedIndex]?.from < b) continue;
        // Preserve indentation, and spaces beside hard breaks / inline atoms.
        if ((a === 0 && b >= 4) || text[a - 1] === '\n' || text[b] === '\n' || text[b] === '\ufffc' || text[a - 1] === '\ufffc') continue;
        const edge = a === 0 || b === text.length;
        const start = pos + 1 + a + (edge ? 0 : 1), end = pos + 1 + b;
        add(Math.max(start, from), Math.min(end, to));
      }
    }
  });
  const tr = closeHistory(state.tr);
  for (const edit of edits.sort((a,b) => b.from - a.from)) {
    if (edit.text) tr.insertText(edit.text, edit.from, edit.to);
    else tr.delete(edit.from, edit.to);
  }
  if (tr.doc.eq(state.doc)) return { tr: state.tr, count: 0, scope: scoped ? 'selection' : 'document', doc: state.doc };
  return { tr, count: edits.length, scope: scoped ? 'selection' : 'document', doc: state.doc };
}
function applyCleanup(editor, plan) {
  if (!editor?.isEditable || editor.isDestroyed || editor.state.doc !== plan.doc || !plan.count) return false;
  editor.view.dispatch(plan.tr);
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}
module.exports = { planCleanup, applyCleanup };
