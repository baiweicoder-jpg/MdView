/* Load after renderer.js: tabs and switchToTab remain owned by the renderer. */
(() => {
  const sidebar = document.querySelector('#sidebar');
  if (!sidebar || document.querySelector('#sidebar-tabs')) return;
  const element = (tag, id, className) => {
    const node = document.createElement(tag);
    if (id) node.id = id;
    if (className) node.className = className;
    return node;
  };
  const tablist = element('div', 'sidebar-tabs');
  tablist.setAttribute('role', 'tablist');
  const outlinePanel = element('section', 'outline-panel', 'sidebar-panel');
  const filesPanel = element('section', 'opened-files-panel', 'sidebar-panel');
  const panels = { outline: outlinePanel, files: filesPanel };
  const switches = {};
  for (const [mode, panel] of Object.entries(panels)) {
    const button = element('button', `sidebar-tab-${mode}`);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => select(mode));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'outline' : event.key === 'End' ? 'files' : mode === 'outline' ? 'files' : 'outline';
      select(next); switches[next].focus();
    });
    switches[mode] = button;
    tablist.append(button);
  }
  // Move, never recreate, the outline so renderer listeners and observers survive.
  outlinePanel.append(sidebar.querySelector('.sidebar-heading'), document.querySelector('#outline'));
  const search = element('input', 'opened-files-search');
  search.type = 'search';
  search.autocomplete = 'off';
  search.spellcheck = false;
  const list = element('div', 'opened-files-list');
  const empty = element('p', 'opened-files-empty');
  empty.setAttribute('role', 'status');
  const selection = window.MdViewFileSelection();
  const tools = element('div', 'opened-files-actions');
  const count = element('span', 'opened-files-count'); count.setAttribute('role', 'status');
  const hint = element('p', 'opened-files-selection-hint');
  const buttons = {};
  for (const action of ['all', 'clear', 'close', 'trash']) {
    const button = element('button', `opened-files-${action}`); button.type = 'button';
    buttons[action] = button; tools.append(button);
  }
  const text = (zh, en) => uiLanguage === 'en' ? en : zh;
  let visibleIds = [], pending = false;
  buttons.all.addEventListener('click', () => { selection.all(visibleIds); renderFiles(); });
  buttons.clear.addEventListener('click', () => { selection.clear(); renderFiles(); });
  for (const action of ['close', 'trash']) buttons[action].addEventListener('click', async () => {
    if (fileBusy || pending || !selection.ids().length) return;
    pending = true; renderFiles();
    try {
      rememberWorkspaceView();
      const result = await window.mdview.batchTabs({ action, ids: selection.ids() });
      for (const id of result.completed || []) if (selection.has(id)) selection.toggle(id, visibleIds);
      if (!result.ok && !result.canceled) {
        $('#notice').textContent = result.message || (result.failures || []).map(item => item.message).join('\n'); $('#notice').hidden = false;
      }
    } catch (error) { $('#notice').textContent = error.message; $('#notice').hidden = false; }
    finally { pending = false; renderFiles(); }
  });
  window.mdview.onBusy(() => renderFiles());
  filesPanel.append(search, count, tools, hint, list, empty);
  sidebar.prepend(tablist, outlinePanel, filesPanel);
  let mode = 'outline';
  function select(next) {
    mode = next;
    for (const key of Object.keys(panels)) {
      panels[key].hidden = key !== mode;
      switches[key].setAttribute('aria-selected', String(key === mode));
      switches[key].tabIndex = key === mode ? 0 : -1;
    }
  }
  function renderFiles() {
    const focused = document.activeElement?.closest('.sidebar-file-entry')?.dataset.id;
    const checkboxFocused = document.activeElement?.classList.contains('sidebar-file-select');
    const query = search.value.trim().toLocaleLowerCase();
    const visible = tabs.filter(tab => !query || `${tab.path ? tab.name : t('未命名.md')}\n${tab.path || ''}`.toLocaleLowerCase().includes(query));
    visibleIds = visible.map(tab => tab.id);
    selection.scope(visibleIds);
    const selected = tabs.filter(tab => selection.has(tab.id));
    count.textContent = text(`已选 ${selected.length} / ${visible.length}`, `${selected.length} selected / ${visible.length} shown`);
    const disabled = fileBusy || pending;
    buttons.all.textContent = text('全选筛选结果', 'Select all shown'); buttons.all.disabled = disabled || !visible.length;
    buttons.clear.textContent = text('清除选择', 'Clear'); buttons.clear.disabled = disabled || !selected.length;
    buttons.close.textContent = text('关闭标签', 'Close tabs'); buttons.close.disabled = disabled || !selected.length;
    buttons.trash.textContent = text('删除文件…', 'Delete files…'); buttons.trash.disabled = disabled || !selected.length || selected.some(tab => !tab.path);
    hint.textContent = selected.some(tab => !tab.path) ? text('未命名文档不能删除磁盘文件，请关闭标签。', 'Untitled documents have no disk file. Use Close tabs.') : text('勾选或 Ctrl 多选，Shift 连选；删除会移入回收站。', 'Checkbox/Ctrl to select; Shift for range. Delete moves files to Recycle Bin.');
    buttons.trash.title = hint.textContent;
    const fragment = document.createDocumentFragment();
    for (const tab of visible) {
      const name = tab.path ? tab.name : t('未命名.md');
      const entry = element('div', null, 'sidebar-file-entry' + (selection.has(tab.id) ? ' selected' : '')); entry.dataset.id = String(tab.id);
      const checkbox = element('input', null, 'sidebar-file-select'); checkbox.type = 'checkbox'; checkbox.checked = selection.has(tab.id); checkbox.disabled = disabled;
      checkbox.setAttribute('aria-label', text(`选择 ${name}`, `Select ${name}`));
      const row = element('button', null, 'sidebar-file' + (tab.active ? ' active' : '') + (tab.dirty ? ' dirty' : ''));
      row.type = 'button';
      row.dataset.id = String(tab.id);
      // tab-name also protects filenames/paths from the renderer chrome translator.
      row.classList.add('tab-name');
      row.title = tab.path || name;
      if (tab.active) row.setAttribute('aria-current', 'page');
      const label = element('span', null, 'tab-name');
      label.textContent = name;
      const dirty = element('span', null, 'sidebar-file-dirty');
      dirty.textContent = tab.dirty ? '●' : '';
      dirty.setAttribute('aria-label', tab.dirty ? t('未保存的更改') : '');
      row.append(label, dirty);
      entry.append(checkbox, row);
      fragment.append(entry);
    }
    list.replaceChildren(fragment);
    empty.hidden = list.children.length > 0;
    empty.textContent = t(query ? '没有匹配的已打开文件' : '没有已打开的文件');
    if (focused) [...list.children].find(row => row.dataset.id === focused)?.querySelector(checkboxFocused ? 'input' : 'button')?.focus({ preventScroll: true });
  }
  search.addEventListener('input', renderFiles);
  list.addEventListener('click', event => {
    const entry = event.target.closest('.sidebar-file-entry');
    if (!entry || fileBusy || pending) return;
    const tab = tabs.find(item => String(item.id) === entry.dataset.id);
    if (!tab) return;
    if (event.target.matches('input') || event.ctrlKey || event.metaKey || event.shiftKey) {
      selection.toggle(tab.id, visibleIds, event.shiftKey); renderFiles(); return;
    }
    if (!tab.active) perform(() => switchToTab(tab.id));
  });
  const resizer = element('div', 'sidebar-resizer');
  resizer.tabIndex = 0;
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-controls', 'sidebar');
  sidebar.append(resizer);
  const storageKey = 'mdview-sidebar-width';
  let preferredWidth = 220;
  try {
    const stored = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0) preferredWidth = Math.max(160, Math.min(520, stored));
  } catch { /* Private storage must not prevent mounting. */ }
  function bounds() {
    const max = Math.max(80, Math.min(520, Math.floor(innerWidth * .45)));
    return { min: Math.min(160, max), max };
  }
  function resize(width, persist = false) {
    const { min, max } = bounds();
    const actual = Math.round(Math.max(min, Math.min(max, width)));
    sidebar.style.width = `${actual}px`;
    resizer.setAttribute('aria-valuemin', String(min));
    resizer.setAttribute('aria-valuemax', String(max));
    resizer.setAttribute('aria-valuenow', String(actual));
    if (persist) {
      preferredWidth = actual;
      try { localStorage.setItem(storageKey, String(actual)); } catch {}
    }
  }
  let drag;
  function finishDrag(event) {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.id)) return;
    drag = null;
    document.body.classList.remove('sidebar-resizing');
    resize(parseFloat(sidebar.style.width), true);
  }
  resizer.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizer.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, width: sidebar.getBoundingClientRect().width };
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add('sidebar-resizing');
  });
  resizer.addEventListener('pointermove', event => {
    if (drag?.id === event.pointerId) resize(drag.width + event.clientX - drag.x);
  });
  resizer.addEventListener('pointerup', finishDrag);
  resizer.addEventListener('pointercancel', finishDrag);
  resizer.addEventListener('lostpointercapture', finishDrag);
  window.addEventListener('blur', finishDrag);
  resizer.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const { min, max } = bounds();
    const step = event.shiftKey ? 40 : 10;
    const next = event.key === 'Home' ? min : event.key === 'End' ? max : sidebar.getBoundingClientRect().width + (event.key === 'ArrowRight' ? step : -step);
    resize(next, true);
  });
  resizer.addEventListener('dblclick', () => resize(220, true));
  window.addEventListener('resize', () => resize(preferredWidth));
  resize(preferredWidth);
  function translate() {
    resizer.setAttribute('aria-label', t('调整侧边栏宽度'));
    resizer.title = t('拖动调整宽度；方向键微调，Home/End 最小或最大，双击重置');
    tablist.setAttribute('aria-label', t('侧边栏视图'));
    switches.outline.textContent = t('文档目录');
    switches.files.textContent = t('打开的文档');
    search.placeholder = t('搜索已打开的文件');
    search.setAttribute('aria-label', t('搜索已打开的文件'));
    renderFiles();
  }
  new MutationObserver(translate).observe(document.querySelector('#tab-bar'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-selected'] });
  select(mode);
  translate();
})();
