import { addRow, addColumn, TableMap } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';

// Work from the node-view's table, never from a retained selection in another table.
export function insertAtBoundary(editor, getPos, axis, index) {
  const pos = getPos();
  if (!editor.isEditable || typeof pos !== 'number') return false;
  const table = editor.state.doc.nodeAt(pos);
  if (table?.type.spec.tableRole !== 'table') return false;
  const map = TableMap.get(table), column = axis === 'column';
  if (!['row', 'column'].includes(axis) || !Number.isInteger(index) || index < 0 || index > (column ? map.width : map.height)
    || (map.width + Number(column)) * (map.height + Number(!column)) > 10000) return false;
  const rect = { table, map, tableStart: pos + 1, left: 0, right: map.width, top: 0, bottom: map.height };
  const tr = closeHistory(editor.state.tr);
  (column ? addColumn : addRow)(tr, rect, index);
  const updated = tr.doc.nodeAt(pos), nextMap = TableMap.get(updated);
  // New rows inherit column alignment and explicit widths, including a new header.
  if (!column) updated.forEach((row, offset, r) => {
    if (r !== index) return;
    row.forEach((cell, cellOffset) => {
      const relative = offset + 1 + cellOffset, c = nextMap.findCell(relative).left;
      const reference = table.nodeAt(map.map[c]);
      tr.setNodeMarkup(pos + 1 + relative, undefined, { ...cell.attrs, align: reference?.attrs.align || null, colwidth: reference?.attrs.colwidth || null });
    });
  });
  const target = nextMap.map[column ? index : index * nextMap.width];
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2 + target)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.view.focus();
  return true;
}

export function createTablePerimeter({ editor, getPos, controls, table, columns, overall, reset }) {
  const doc = table.ownerDocument, win = doc.defaultView;
  const top = doc.createElement('div'), left = doc.createElement('div');
  top.className = 'table-insert-columns'; left.className = 'table-insert-rows';
  controls.append(top, left);
  let frame = 0;
  let tooltip = null, tooltipTarget = null;
  function hideTooltip() { tooltip?.remove(); tooltip = null; tooltipTarget = null; }
  function positionTooltip() {
    if (!tooltip || !tooltipTarget?.isConnected || controls.hidden) { hideTooltip(); return; }
    const r = tooltipTarget.getBoundingClientRect(), bounds = table.getBoundingClientRect();
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight, gap = 6, inset = 4;
    let x = r.left + r.width / 2 - width / 2;
    // A row boundary sits beside the content, not above it. Prefer the table's
    // top gutter so its tooltip cannot cover the preceding row/header.
    let y = Math.min(r.top, bounds.top) - height - gap;
    if (y < inset) {
      if (bounds.left - width - gap >= inset) { x = bounds.left - width - gap; y = r.top; }
      else if (bounds.right + width + gap <= win.innerWidth - inset) { x = bounds.right + gap; y = r.top; }
      else if (bounds.bottom + height + gap <= win.innerHeight - inset) y = bounds.bottom + gap;
    }
    tooltip.style.left = `${Math.max(inset, Math.min(x, win.innerWidth - width - inset))}px`;
    tooltip.style.top = `${Math.max(inset, Math.min(y, win.innerHeight - height - inset))}px`;
  }
  function showTooltip(button) {
    hideTooltip(); tooltipTarget = button;
    tooltip = doc.createElement('div'); tooltip.className = 'table-perimeter-tooltip';
    tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = button.dataset.tooltip;
    doc.body.append(tooltip); positionTooltip();
  }
  function buttons(container, count, axis) {
    if (container.children.length === count) return;
    container.replaceChildren();
    for (let i = 0; i < count; i++) {
      const button = doc.createElement('button'); button.type = 'button';
      button.dataset[axis === 'column' ? 'insertColumn' : 'insertRow'] = String(i);
      const label = axis === 'column' ? '插入列 / Insert column' : '插入行 / Insert row';
      button.setAttribute('aria-label', `${label} · ${i + 1}`); button.dataset.tooltip = label;
      const plus = doc.createElement('span'); plus.textContent = '+'; plus.setAttribute('aria-hidden', 'true'); button.append(plus);
      button.addEventListener('pointerenter', () => showTooltip(button));
      button.addEventListener('focus', () => showTooltip(button));
      button.addEventListener('pointerleave', () => { if (tooltipTarget === button && doc.activeElement !== button) hideTooltip(); });
      button.addEventListener('blur', () => { if (tooltipTarget === button) hideTooltip(); });
      button.addEventListener('click', () => { hideTooltip(); insertAtBoundary(editor, getPos, axis, i); });
      container.append(button);
    }
  }
  function layout() {
    frame = 0;
    if (!table.isConnected) return;
    const rect = table.getBoundingClientRect(), scale = rect.width / table.offsetWidth || 1;
    const rows = [...table.rows], cells = [...(rows[0]?.cells || [])];
    buttons(top, cells.length + 1, 'column'); buttons(left, rows.length + 1, 'row');
    controls.style.width = `${rect.width / scale}px`; controls.style.height = `${rect.height / scale}px`;
    controls.style.setProperty('--table-width', `${rect.width / scale}px`);
    controls.style.setProperty('--table-height', `${rect.height / scale}px`);
    cells.forEach((cell, i) => {
      const b = cell.getBoundingClientRect(), x = (b.right - rect.left) / scale;
      const handle = columns.children[i];
      if (handle) { handle.style.left = `${x}px`; handle.style.height = `${rect.height / scale}px`; }
      top.children[i].style.left = `${(b.left - rect.left) / scale}px`;
    });
    top.lastElementChild.style.left = `${rect.width / scale}px`;
    rows.forEach((row, i) => { left.children[i].style.top = `${(row.getBoundingClientRect().top - rect.top) / scale}px`; });
    left.lastElementChild.style.top = `${rect.height / scale}px`;
    overall.style.left = `${rect.width / scale}px`;
    reset.hidden = !table.querySelector('col')?.style.width;
    positionTooltip();
  }
  function schedule() { if (!frame) frame = win.requestAnimationFrame(layout); }
  const observer = new win.ResizeObserver(schedule); observer.observe(table);
  win.addEventListener('scroll', positionTooltip, true);
  win.addEventListener('resize', schedule);
  return { schedule, destroy() { hideTooltip(); observer.disconnect(); win.cancelAnimationFrame(frame); win.removeEventListener('scroll',positionTooltip,true); win.removeEventListener('resize',schedule); } };
}
