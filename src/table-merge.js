import { closeHistory } from '@tiptap/pm/history';

const reasons = {
  readonly: ['只读模式不能合并表格。', 'Tables cannot be merged in read-only mode.'],
  nested: ['仅支持同一文档层级的非嵌套表格。', 'Only non-nested document-level tables can be merged.'],
  adjacent: ['相邻表格之间只能有空白普通段落。', 'Only empty plain paragraphs may separate adjacent tables.'],
  columns: ['两个表格的列数不同，无法合并。', 'The tables have different column counts.'],
  spans: ['暂不支持含跨行、跨列或嵌套内容的表格合并。', 'Tables with merged cells or nested content cannot be merged.'],
  size: ['合并后不能超过 10000 个单元格。', 'The merged table cannot exceed 10000 cells.'],
};
export function mergeReason(reason, english = false) { return reasons[reason]?.[english ? 1 : 0] || ''; }
const isTable = node => node?.type.spec.tableRole === 'table';
function emptyPlain(node) {
  let plainWhitespace = true;
  node.forEach(child => { if (!child.isText || child.marks.length || !/^\s*$/u.test(child.text)) plainWhitespace = false; });
  return node.type.name === 'paragraph' && plainWhitespace && !node.marks.length
    && Object.entries(node.attrs).every(([key,value]) => value === node.type.defaultAttrs?.[key]);
}
// Deliberately fail closed for nested tables and spans: Markdown cannot retain them.
export function planTableMerge(editor, direction, position = editor.state.selection.from) {
  if (!editor.isEditable) return {reason:'readonly'};
  if (!['above','below'].includes(direction)) return {reason:'adjacent'};
  const {doc} = editor.state;
  let $pos;
  try { $pos = doc.resolve(position); } catch { return {reason:'adjacent'}; }
  let depth = $pos.depth;
  while (depth && !isTable($pos.node(depth))) depth--;
  if (!depth) return {reason:'adjacent'};
  if (depth !== 1) return {reason:'nested'};
  const children=[]; doc.forEach((node,pos)=>children.push({node,pos}));
  const index = $pos.index(0), step = direction === 'above' ? -1 : 1;
  let next = index + step;
  while (children[next] && emptyPlain(children[next].node)) next += step;
  if (!isTable(children[next]?.node)) return {reason:'adjacent'};
  const [upper,lower] = [children[Math.min(index,next)],children[Math.max(index,next)]];
  const columns = upper.node.firstChild?.childCount;
  for (const {node} of [upper,lower]) {
    let unsupported = false, unequal = false;
    node.forEach(row=>{
      if (row.childCount !== columns) unequal = true;
      row.forEach(cell=>{
        if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1 || cell.childCount !== 1 || cell.firstChild.type.name !== 'paragraph') unsupported = true;
      });
    });
    if (unsupported) return {reason:'spans'};
    if (unequal || !columns) return {reason:'columns'};
  }
  if ((upper.node.childCount + lower.node.childCount) * columns > 10000) return {reason:'size'};
  return {upper,lower};
}
export function mergeAdjacentTables(editor, direction, position) {
  const plan = planTableMerge(editor,direction,position);
  if (plan.reason) return false;
  const {upper,lower} = plan;
  const tr = closeHistory(editor.state.tr), boundary = upper.pos + upper.node.nodeSize;
  // Join rather than replace: PM maps text/cell selections through removed wrapper
  // tokens while retaining all row content, marks, images and node attributes.
  if (boundary !== lower.pos) tr.delete(boundary,lower.pos);
  tr.join(boundary);
  const joined = tr.doc.nodeAt(upper.pos);
  joined.forEach((row,offset,r)=>row.forEach((cell,cellOffset,c)=>{
    const type = r < upper.node.childCount ? cell.type : editor.state.schema.nodes.tableCell;
    const attrs = {...cell.attrs,colwidth:upper.node.firstChild.child(c).attrs.colwidth};
    tr.setNodeMarkup(upper.pos + 2 + offset + cellOffset,type,attrs,cell.marks);
  }));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

export function appendTableMergeActions(menu, editor, position, close, text) {
  const doc = menu.ownerDocument;
  for (const [direction,zh,en] of [['above','合并上方表格','Merge table above'],['below','与下一个表格合并','Merge with next table']]) {
    const button=doc.createElement('button'); button.type='button'; button.dataset.tableAction=`merge${direction === 'above' ? 'Above' : 'Below'}`;
    button.setAttribute('role','menuitem'); button.textContent=text(zh,en);
    const plan=planTableMerge(editor,direction,position);
    button.disabled=!!plan.reason;
    if (plan.reason) {
      const reason=text(mergeReason(plan.reason),mergeReason(plan.reason,true));
      button.title=reason; button.setAttribute('aria-label',`${button.textContent}: ${reason}`);
    }
    button.addEventListener('mousedown',event=>event.preventDefault());
    button.addEventListener('click',()=>{ if(mergeAdjacentTables(editor,direction,position))close(true); });
    menu.append(button);
  }
}
