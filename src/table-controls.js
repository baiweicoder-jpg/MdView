import { CellSelection, cellAround, selectedRect } from '@tiptap/pm/tables';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

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
    if (!contained($cell)) {
      mode = null; anchor = null;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve($cell.pos + 1))));
    }
    menu = doc.createElement('div'); menu.className = 'table-context-menu'; menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', text('表格操作', 'Table actions'));
    const help = doc.createElement('p'); help.className = 'table-selection-help';
    help.textContent = text('选择行/列后，按住 Shift 点击另一单元格可连续多选；右键高亮区域可删除。', 'Select rows/columns, then Shift-click another cell to extend the range. Right-click the highlight to delete.');
    menu.append(help);
    for (const [name, label] of Object.entries(labels)) {
      const button = doc.createElement('button'); button.type = 'button'; button.dataset.tableAction = name;
      button.setAttribute('role', 'menuitem'); button.textContent = text(...label);
      button.disabled = name.startsWith('select') ? false : !editor.can()[name]();
      button.addEventListener('mousedown', e => e.preventDefault());
      button.addEventListener('click', () => {
        if (!editor.isEditable) { close(); return; }
        if (name === 'selectRows' || name === 'selectColumns') select(name === 'selectRows' ? 'row' : 'column', $cell);
        else {
          editor.view.dispatch(closeHistory(editor.state.tr));
          editor.commands[name]();
          editor.view.dispatch(closeHistory(editor.state.tr));
          mode = null; anchor = null;
        }
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
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
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
  root.addEventListener('mousedown', mousedown, true);
  root.addEventListener('contextmenu', context, true);
  doc.addEventListener('mousedown', outside, true);
  doc.addEventListener('keydown', key, true);
  win.addEventListener('resize', onViewport);
  win.addEventListener('scroll', onViewport, true);
  editor.on('transaction', transaction);
  const api = { destroy() {
    close(); root.removeEventListener('mousedown', mousedown, true); root.removeEventListener('contextmenu', context, true);
    doc.removeEventListener('mousedown', outside, true); doc.removeEventListener('keydown', key, true);
    win.removeEventListener('resize', onViewport); win.removeEventListener('scroll', onViewport, true);
    editor.off('transaction', transaction); editor.off('destroy', api.destroy);
    if (!editor.isDestroyed) editor.unregisterPlugin(headersKey);
    installed.delete(editor);
  } };
  installed.set(editor, api); editor.on('destroy', api.destroy);
  return api;
}
