import { CellSelection, cellAround, selectedRect, addRow, TableMap } from '@tiptap/pm/tables';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';


function addStyledRow(tr, rect, index) {
  addRow(tr, rect, index);
  const table = tr.doc.nodeAt(rect.tableStart - 1), map = TableMap.get(table);
  let offset = 0;
  for (let i = 0; i < index; i++) offset += table.child(i).nodeSize;
  table.child(index).forEach((cell, cellOffset) => {
    const relative = offset + 1 + cellOffset;
    const column = map.findCell(relative).left;
    const reference = rect.table.nodeAt(rect.map.map[column]);
    tr.setNodeMarkup(rect.tableStart + relative, undefined, { ...cell.attrs,
      align: reference?.attrs.align || null, colwidth: reference?.attrs.colwidth || null });
  });
}

// Reject rather than truncate: a batch is all-or-nothing and one history event.
export function insertTableRows(editor, amount, before = false) {
  if (!editor.isEditable || !/^[1-9]\d*$/.test(String(amount))) return false;
  const count = Number(amount);
  if (!Number.isSafeInteger(count) || count > 100) return false;
  let rect;
  try { rect = selectedRect(editor.state); } catch { return false; }
  if ((rect.map.height + count) * rect.map.width > 10000) return false;
  const tr = closeHistory(editor.state.tr);
  for (let i = 0; i < count; i++) {
    rect = selectedRect({ doc: tr.doc, selection: tr.selection });
    addStyledRow(tr, rect, before ? rect.top : rect.bottom);
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

const headersKey = new PluginKey('mdviewTableHeaders');
const installed = new WeakMap();
// Markdown has one header row. Keep that invariant after deleting/inserting the
// first row, including actions from the existing inspector. Appended steps belong
// to the originating history event, so a single Undo restores the whole action.
function headerPlugin() {
  return new Plugin({ key: headersKey, appendTransaction(transactions, _old, state) {
    if (!transactions.some(tr => tr.docChanged)) return null;
    const tr = state.tr;
    state.doc.descendants((table, pos) => {
      if (table.type.spec.tableRole !== 'table') return;
      table.forEach((row, offset, index) => row.forEach((cell, cellOffset) => {
        const type = index === 0 ? state.schema.nodes.tableHeader : state.schema.nodes.tableCell;
        if (type && cell.type !== type) tr.setNodeMarkup(pos + 2 + offset + cellOffset, type, cell.attrs, cell.marks);
      }));
      return false;
    });
    return tr.docChanged ? tr : null;
  } });
}

/** Install once per editor. CSS must be loaded by the host. Destroy is automatic.
 * Gesture: right-click cell → Select rows/columns → Shift-click another cell.
 * Right-click any highlighted cell → delete selected rows/columns.
 */
export function installTableControls(editor) {
  if (installed.has(editor)) return installed.get(editor);
  editor.registerPlugin(headerPlugin());
  const root = editor.view.dom, doc = root.ownerDocument, win = doc.defaultView;
  let mode = null, anchor = null, menu = null;
  const en = () => doc.documentElement.lang.toLowerCase().startsWith('en');
  const text = (zh, english) => en() ? english : zh;
  const labels = {
    selectRows: ['选择行', 'Select rows'], selectColumns: ['选择列', 'Select columns'],
    addRowBefore: ['在上方插入行', 'Insert row above'], addRowAfter: ['在下方插入行', 'Insert row below'],
    addColumnBefore: ['在左侧插入列', 'Insert column left'], addColumnAfter: ['在右侧插入列', 'Insert column right'],
    deleteRow: ['删除所选行', 'Delete selected rows'], deleteColumn: ['删除所选列', 'Delete selected columns'],
  };
  function close(focus = false) { menu?.remove(); menu = null; if (focus && !editor.isDestroyed) editor.view.focus(); }
  function cellAt(target) {
    const cell = target?.closest?.('td,th');
    if (!cell || !root.contains(cell)) return null;
    try { return cellAround(editor.state.doc.resolve(editor.view.posAtDOM(cell, 0))); } catch { return null; }
  }
  function contained($cell) {
    const selection = editor.state.selection;
    if (!(selection instanceof CellSelection) || selection.$anchorCell.start(-1) !== $cell.start(-1)) return false;
    const rect = selectedRect(editor.state), target = rect.map.findCell($cell.pos - rect.tableStart);
    return target.left >= rect.left && target.right <= rect.right && target.top >= rect.top && target.bottom <= rect.bottom;
  }
  function select(axis, $cell, extend = false) {
    let $anchor = $cell;
    if (extend && mode === axis && anchor !== null) {
      try {
        const resolved = editor.state.doc.resolve(anchor);
        if (resolved.nodeAfter?.type.spec.tableRole?.includes('cell') && resolved.start(-1) === $cell.start(-1)) $anchor = resolved;
      } catch { /* Stale anchors never escape into commands. */ }
    }
    anchor = $anchor.pos; mode = axis;
    const selection = axis === 'row' ? CellSelection.rowSelection($anchor, $cell) : CellSelection.colSelection($anchor, $cell);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
    editor.view.focus();
  }
  function structuralAction(name) {
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor.commands[name]();
    editor.view.dispatch(closeHistory(editor.state.tr));
    mode = null; anchor = null;
  }
  function tableEnter(event) {
    if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing || event.keyCode === 229
      || editor.view.composing || !editor.isEditable || event.altKey || event.metaKey
      || (event.ctrlKey && event.shiftKey) || event.target.closest?.('input,textarea,select,button,[contenteditable="false"]')) return;
    const { state, view } = editor, { selection } = state;
    if (!(selection instanceof TextSelection) || !selection.empty || selection.$from.parent.type.name !== 'paragraph') return;
    const $cell = cellAround(selection.$from);
    if (!$cell) return;
    const rect = selectedRect(state), first = rect.top === 0, last = rect.bottom === rect.map.height;
    const above = event.ctrlKey && first, below = event.shiftKey && last;
    if (!above && !below && (event.ctrlKey || event.shiftKey || !last)) return;
    const tr = closeHistory(state.tr);
    if (above || below) {
      const tablePos = rect.tableStart - 1, edge = above ? tablePos : tablePos + rect.table.nodeSize;
      const $edge = state.doc.resolve(edge), adjacent = above ? $edge.nodeBefore : $edge.nodeAfter;
      const reuse = adjacent?.type.name === 'paragraph' && adjacent.content.size === 0;
      const target = above && reuse ? edge - adjacent.nodeSize : edge;
      if (!reuse) tr.insert(edge, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.create(tr.doc, target + 1));
    } else {
      if ((rect.map.height + 1) * rect.map.width > 10000) { event.preventDefault(); return; }
      addStyledRow(tr, rect, rect.map.height);
      const table = tr.doc.nodeAt(rect.tableStart - 1);
      let pos = rect.tableStart;
      for (let r = 0; r < table.childCount - 1; r++) pos += table.child(r).nodeSize;
      const row = table.lastChild; pos++;
      for (let c = 0; c < Math.min(rect.left, row.childCount - 1); c++) pos += row.child(c).nodeSize;
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
    }
    event.preventDefault(); event.stopPropagation();
    view.dispatch(tr.scrollIntoView()); view.dispatch(closeHistory(editor.state.tr));
  }
  function deleteSelection(event) {
    // Capture on this editor only, before Tiptap's cell-content deletion keymap.
    // A text range (even across cells) is never a structural selection.
    if (!['Backspace', 'Delete'].includes(event.key) || event.defaultPrevented
      || event.isComposing || event.keyCode === 229 || editor.view.composing
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      || !editor.isEditable || event.target.closest?.('input,textarea,select,button,[contenteditable="false"]')) return;
    const selection = editor.state.selection;
    if (!(selection instanceof CellSelection)) return;
    const rows = selection.isRowSelection(), columns = selection.isColSelection();
    if (!rows && !columns) return; // Partial rectangles retain normal cell clearing.
    // Selecting the entire table covers both axes, including its last row/column.
    const name = rows && columns ? 'deleteTable' : rows ? 'deleteRow' : 'deleteColumn';
    if (!editor.can()[name]()) return;
    event.preventDefault(); event.stopPropagation();
    structuralAction(name);
    close(true);
  }
  function mousedown(event) {
    if (!editor.isEditable) return;
    const $cell = cellAt(event.target);
    if (!$cell) return;
    if (event.button === 2 && contained($cell)) { event.preventDefault(); event.stopPropagation(); return; }
    if (event.button === 0 && event.shiftKey && mode && editor.state.selection instanceof CellSelection) {
      event.preventDefault(); event.stopPropagation(); close(); select(mode, $cell, true);
    } else if (event.button === 0) { mode = null; anchor = null; }
  }
  function context(event) {
    if (!editor.isEditable) return;
    const $cell = cellAt(event.target);
    if (!$cell) return;
    event.preventDefault(); event.stopPropagation(); close();
    if (!contained($cell) && !event.mdviewTextSelection) {
      mode = null; anchor = null;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve($cell.pos + 1))));
    }
    menu = doc.createElement('div'); menu.className = 'table-context-menu'; menu.setAttribute('role', 'menu');
    menu.addEventListener('mdview-dismiss-context', () => close());
    menu.setAttribute('aria-label', text('表格操作', 'Table actions'));
    const help = doc.createElement('p'); help.className = 'table-selection-help';
    help.textContent = text('选择行/列后，按住 Shift 点击另一单元格可连续多选；右键高亮区域可删除。', 'Select rows/columns, then Shift-click another cell to extend the range. Right-click the highlight to delete.');
    menu.append(help);
    const countLabel = doc.createElement('label'); countLabel.className = 'table-row-count-label';
    countLabel.textContent = text('插入行数（1–100）', 'Rows to insert (1–100)');
    const countInput = doc.createElement('input'); countInput.type = 'number'; countInput.min = '1'; countInput.max = '100'; countInput.step = '1'; countInput.value = '1'; countInput.dataset.tableRowCount = '';
    countInput.setAttribute('aria-label', countLabel.textContent); countLabel.append(countInput); menu.append(countLabel);
    const error = doc.createElement('p'); error.setAttribute('role', 'alert'); error.className = 'table-selection-help'; menu.append(error);
    for (const [name, label] of Object.entries(labels)) {
      const button = doc.createElement('button'); button.type = 'button'; button.dataset.tableAction = name;
      button.setAttribute('role', 'menuitem'); button.textContent = text(...label);
      button.disabled = name.startsWith('select') ? false : !editor.can()[name]();
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', () => {
        if (!editor.isEditable) { close(); return; }
        if (name === 'selectRows' || name === 'selectColumns') select(name === 'selectRows' ? 'row' : 'column', $cell);
        else if (name === 'addRowBefore' || name === 'addRowAfter') {
          if (!insertTableRows(editor, countInput.value, name === 'addRowBefore')) {
            error.textContent = text('请输入 1–100 的整数；表格最多 10000 个单元格。', 'Enter an integer from 1–100; maximum 10000 table cells.');
            countInput.setAttribute('aria-invalid', 'true'); countInput.focus(); return;
          }
        } else structuralAction(name);
        close(true);
      });
      menu.append(button);
    }

    doc.body.append(menu);
    // CSSOM positioning works with the app's strict style-src 'self' CSP.
    menu.style.left = `${Math.max(4, Math.min(event.clientX, win.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(event.clientY, win.innerHeight - menu.offsetHeight - 4))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  function outside(event) { if (menu && !menu.contains(event.target)) close(); }
  function key(event) {
    if (!menu) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !event.target.closest?.('input')) {
      event.preventDefault();
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      let index = buttons.indexOf(doc.activeElement);
      index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    } else if (event.key === 'Tab') close();
  }
  function transaction({ transaction: tr }) {
    if (tr.docChanged) { close(); mode = null; anchor = null; }
  }
  const onViewport = () => close();
  root.addEventListener('keydown', tableEnter, true);
  root.addEventListener('keydown', deleteSelection, true);
  root.addEventListener('mousedown', mousedown, true);
  root.addEventListener('contextmenu', context, true);
  doc.addEventListener('mousedown', outside, true);
  doc.addEventListener('keydown', key, true);
  win.addEventListener('resize', onViewport);
  win.addEventListener('scroll', onViewport, true);
  editor.on('transaction', transaction);
  const api = { destroy() {
    close(); root.removeEventListener('keydown', tableEnter, true); root.removeEventListener('keydown', deleteSelection, true);
    root.removeEventListener('mousedown', mousedown, true); root.removeEventListener('contextmenu', context, true);
    doc.removeEventListener('mousedown', outside, true); doc.removeEventListener('keydown', key, true);
    win.removeEventListener('resize', onViewport); win.removeEventListener('scroll', onViewport, true);
    editor.off('transaction', transaction); editor.off('destroy', api.destroy);
    if (!editor.isDestroyed) editor.unregisterPlugin(headersKey);
    installed.delete(editor);
  } };
  installed.set(editor, api); editor.on('destroy', api.destroy);
  return api;
}
