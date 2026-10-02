import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';

const installed = new WeakMap();
const key = new PluginKey('mdviewImageGroup');
const empty = () => ({ positions: [], anchor: null });

// Track positions through every step, retaining an attribute-only replacement,
// but never transferring selection from a deleted image to its next sibling.
function mappedPosition(pos, tr) {
  if (pos === null) return null;
  for (let i = 0; i < tr.mapping.maps.length; i++) {
    const map = tr.mapping.maps[i], result = map.mapResult(pos, 1);
    if (result.deleted) {
      let replacement = null;
      map.forEach((a, b, c, d) => {
        if (a !== pos || b - a !== 1 || d - c !== 1) return;
        const before = tr.docs[i].nodeAt(a), after = (tr.docs[i + 1] || tr.doc).nodeAt(c);
        if (before?.type.name === 'image' && after?.type.name === 'image'
          && ['src', 'alt', 'title'].every(name => before.attrs[name] === after.attrs[name])) replacement = c;
      });
      if (replacement === null) return null;
      pos = replacement;
    } else pos = result.pos;
  }
  return tr.doc.nodeAt(pos)?.type.name === 'image' ? pos : null;
}

/** Ctrl/Cmd-click toggles; Shift-click extends an image range in document order.
 * Load image-group-controls.css in the host. Installation is idempotent and is
 * automatically disposed with editor.destroy() (including tab teardown).
 */
export function installImageGroupControls(editor) {
  if (installed.has(editor)) return installed.get(editor);
  const root = editor.view.dom, doc = root.ownerDocument, win = doc.defaultView;
  let menu = null, disposed = false;
  const text = (zh, en) => doc.documentElement.lang.toLowerCase().startsWith('en') ? en : zh;
  editor.registerPlugin(new Plugin({
    key,
    state: {
      init: empty,
      apply(tr, value) {
        if (!editor.isEditable) return empty();
        const explicit = tr.getMeta(key);
        if (explicit) return explicit;
        return { positions: value.positions.map(pos => mappedPosition(pos, tr)).filter(pos => pos !== null), anchor: mappedPosition(value.anchor, tr) };
      },
    },
    props: { decorations(state) {
      if (!editor.isEditable) return DecorationSet.empty;
      return DecorationSet.create(state.doc, key.getState(state).positions.map(pos => Decoration.node(pos, pos + 1, {
        class: 'image-group-selected', 'data-image-group-selected': 'true',
      })));
    } },
  }));
  const selection = () => key.getState(editor.state) || empty();
  function close(focus = false) {
    menu?.remove(); menu = null;
    if (focus && !editor.isDestroyed) editor.view.focus();
  }
  function select(value) { editor.view.dispatch(editor.state.tr.setMeta(key, value).setMeta('addToHistory', false)); }
  function clear() { if (selection().positions.length || selection().anchor !== null) select(empty()); close(); }
  function imageAt(target) {
    const dom = target?.closest?.('.editor-image');
    if (!dom || !root.contains(dom)) return null;
    let result = null;
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image' && editor.view.nodeDOM(pos) === dom) result = pos; });
    return result;
  }
  function control(target) { return target?.closest?.('.image-size-controls, .image-resize-handles'); }
  function block(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function pointer(event) {
    if (!editor.isEditable) { clear(); return; }
    const pos = imageAt(event.target);
    if (pos === null || (control(event.target) && !(event.ctrlKey || event.metaKey || event.shiftKey))) { if (event.button === 0) clear(); return; }
    const current = selection();
    if (event.button === 2 && current.positions.includes(pos)) { block(event); return; }
    if (event.button !== 0) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      block(event); close();
      let positions;
      if (event.shiftKey && current.anchor !== null) {
        positions = [];
        const lo = Math.min(pos, current.anchor), hi = Math.max(pos, current.anchor);
        editor.state.doc.descendants((node, p) => { if (node.type.name === 'image' && p >= lo && p <= hi) positions.push(p); });
        // Preserve the first-selected image as the reference height.
        positions = [current.anchor, ...positions.filter(p => p !== current.anchor)];
      } else positions = current.positions.includes(pos) ? current.positions.filter(p => p !== pos) : [...current.positions, pos];
      select({ positions, anchor: event.shiftKey && current.anchor !== null ? current.anchor : pos });
      editor.view.focus();
    } else clear(); // Ordinary image drag/resize and normal text selection are unchanged.
  }
  function mouse(event) {
    const pos = imageAt(event.target);
    if (editor.isEditable && pos !== null
      && ((event.button === 2 && !control(event.target) && selection().positions.includes(pos))
        || (event.button === 0 && (event.ctrlKey || event.metaKey || event.shiftKey)))) block(event);
  }
  function drag(event) { if (imageAt(event.target) !== null && (event.ctrlKey || event.metaKey || event.shiftKey)) block(event); }
  function context(event) {
    if (!editor.isEditable || imageAt(event.target) === null || control(event.target)) return;
    const pos = imageAt(event.target);
    block(event);
    if (!selection().positions.includes(pos)) select({ positions: [pos], anchor: pos });
    open(event.clientX, event.clientY);
  }
  function measurements() {
    return selection().positions.map(pos => {
      const dom = editor.view.nodeDOM(pos), image = dom?.querySelector('img');
      const parent = dom?.parentElement, style = parent && win.getComputedStyle(parent);
      const available = parent ? parent.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0) : 0;
      return { pos, ratio: image?.complete && !image.hidden && image.naturalWidth > 0 && image.naturalHeight > 0
        ? image.naturalWidth / image.naturalHeight : 0,
      height: image?.getBoundingClientRect().height || 0, maxWidth: Math.min(1600, Math.floor(available)) };
    });
  }
  function bounds(items) {
    const ready = items.length > 0 && items.every(item => item.ratio > 0 && item.maxWidth >= 32);
    return { min: ready ? Math.max(...items.map(item => 32 / item.ratio)) : Infinity,
      max: ready ? Math.min(...items.map(item => item.maxWidth / item.ratio)) : -Infinity };
  }
  function apply(dimension, value, status) {
    if (!editor.isEditable || editor.isDestroyed) { close(); return; }
    const items = measurements(), range = bounds(items);
    const valid = items.length && Number.isFinite(value) && (dimension === 'width'
      ? Number.isInteger(value) && value >= 32 && value <= 1600
      : value >= range.min - 0.001 && value <= range.max + 0.001);
    if (!valid) { status.textContent = text('尺寸超出共同可用范围，未更改任何图片。', 'Outside the shared size range; no images changed.'); return; }
    const tr = editor.state.tr;
    for (const item of items) {
      const node = tr.doc.nodeAt(item.pos);
      if (node?.type.name !== 'image') return;
      const width = dimension === 'width' ? value : Math.round(value * item.ratio);
      // Never clamp each image separately: that would silently break alignment.
      if (width < 32 || width > 1600 || (dimension === 'height' && width > item.maxWidth)) {
        status.textContent = text('整数宽度超出共同范围，未更改任何图片。', 'Rounded widths exceed the shared range; no images changed.'); return;
      }
      if (node.attrs.width !== width) tr.setNodeMarkup(item.pos, undefined, { ...node.attrs, width });
    }
    if (tr.docChanged) {
      editor.view.dispatch(closeHistory(tr));
      editor.view.dispatch(closeHistory(editor.state.tr));
    }
    close(true);
  }
  function open(x, y) {
    close();
    const items = measurements(), range = bounds(items), target = items[0]?.height;
    menu = doc.createElement('div'); menu.className = 'image-group-menu';
    menu.addEventListener('mdview-dismiss-context', () => close());
    menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', text('批量图片尺寸', 'Batch image size'));
    const heading = doc.createElement('strong');
    heading.textContent = text(`已选择 ${items.length} 张图片`, `${items.length} images selected`);
    const help = doc.createElement('p');
    help.textContent = text('Ctrl/Cmd 点击多选，Shift 点击连续多选。', 'Ctrl/Cmd-click to toggle; Shift-click for a range.');
    const status = doc.createElement('p'); status.className = 'image-group-status'; status.setAttribute('role', 'status');
    const feasible = range.min <= range.max;
    status.textContent = feasible ? text(
      `共同高度范围：${range.min.toFixed(2)}–${range.max.toFixed(2)} px。按各图原始比例换算为整数宽度，可能有舍入误差。宽度为首选尺寸，窄窗口会缩小显示。`,
      `Shared height range: ${range.min.toFixed(2)}–${range.max.toFixed(2)} px. Natural aspect ratios are preserved; integer widths may round heights slightly. Width is preferred size; narrow windows scale it down.`)
      : text('图片未加载或没有共同高度范围，无法统一高度。', 'Images are not loaded or have no shared height range; height actions are unavailable.');
    function button(name, label, action) {
      const result = doc.createElement('button'); result.type = 'button'; result.dataset.imageGroupAction = name;
      result.textContent = label; result.addEventListener('click', action); return result;
    }
    const equal = button('equalHeight', text('统一高度（以首选图片为准）', 'Match first-selected image height'), () => apply('height', measurements()[0]?.height, status));
    equal.disabled = !feasible || target < range.min - 0.001 || target > range.max + 0.001;
    if (equal.disabled && feasible) status.textContent += text(' 首选图片高度不在共同范围内，请输入共同高度。', ' The first-selected height is outside this range; enter a shared height instead.');
    menu.append(heading, help, equal);
    for (const dimension of ['width', 'height']) {
      const label = doc.createElement('label');
      label.append(doc.createTextNode(dimension === 'width' ? text('宽度 (px)', 'Width (px)') : text('高度 (px)', 'Height (px)')));
      const input = doc.createElement('input'); input.type = 'number'; input.dataset.imageGroupDimension = dimension;
      input.min = String(dimension === 'width' ? 32 : feasible ? range.min : 0);
      input.max = String(dimension === 'width' ? 1600 : feasible ? range.max : 0);
      input.step = dimension === 'width' ? '1' : 'any';
      input.value = dimension === 'width' ? String(editor.state.doc.nodeAt(items[0]?.pos)?.attrs.width || 320)
        : feasible ? String(Math.max(range.min, Math.min(range.max, target))) : '';
      input.disabled = dimension === 'height' && !feasible;
      label.append(input); menu.append(label);
      const commit = () => { if (input.value === '' || !input.checkValidity()) { input.reportValidity(); return; } apply(dimension, Number(input.value), status); };
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } });
      const action = button(dimension, dimension === 'width' ? text('应用共同宽度', 'Apply common width') : text('应用共同高度', 'Apply common height'), commit);
      action.disabled = input.disabled; menu.append(action);
    }
    menu.append(status); doc.body.append(menu);
    menu.style.left = `${Math.max(4, Math.min(x, win.innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, win.innerHeight - menu.offsetHeight - 4))}px`;
    menu.querySelector('button:not(:disabled), input:not(:disabled)')?.focus();
  }
  function outside(event) { if (menu && !menu.contains(event.target)) close(); if (!root.contains(event.target) && !menu?.contains(event.target)) clear(); }
  function keyboard(event) {
    if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
      && editor.isEditable && selection().positions.length && root.contains(doc.activeElement)) {
      block(event);
      const rect = editor.view.nodeDOM(selection().positions[0]).getBoundingClientRect();
      open(rect.left, rect.bottom); return;
    }
    if (event.key === 'Escape' && (menu || selection().positions.length)) { block(event); close(true); clear(); }
  }
  function transaction({ transaction: tr }) { if (tr.docChanged || !editor.isEditable) close(); }
  // setEditable(false, false) intentionally emits no editor update event.
  const observer = new MutationObserver(() => { if (!editor.isEditable) clear(); });
  observer.observe(root, { attributes: true, attributeFilter: ['contenteditable'] });
  const viewport = () => close();
  root.addEventListener('pointerdown', pointer, true);
  root.addEventListener('mousedown', mouse, true);
  root.addEventListener('dragstart', drag, true);
  root.addEventListener('contextmenu', context, true);
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('keydown', keyboard, true);
  win.addEventListener('resize', viewport);
  win.addEventListener('scroll', viewport, true);
  editor.on('transaction', transaction);
  const api = { destroy() {
    if (disposed) return;
    disposed = true; close(); observer.disconnect();
    root.removeEventListener('pointerdown', pointer, true); root.removeEventListener('mousedown', mouse, true);
    root.removeEventListener('dragstart', drag, true); root.removeEventListener('contextmenu', context, true);
    doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', keyboard, true);
    win.removeEventListener('resize', viewport); win.removeEventListener('scroll', viewport, true);
    editor.off('transaction', transaction); editor.off('destroy', api.destroy);
    if (!editor.isDestroyed) editor.unregisterPlugin(key);
    installed.delete(editor);
  } };
  installed.set(editor, api); editor.on('destroy', api.destroy);
  return api;
}
