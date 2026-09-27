/* Shared select adapter: native values/options/change remain the renderer contract. */
(() => {
  const adapters = new Map();
  let serial = 0;
  function install(select) {
  if (adapters.has(select)) return;
  const id = select.id || `code-language-${++serial}`;
  const controller = new AbortController();
  const signal = controller.signal;
  const trigger = document.createElement('button');
  trigger.id = `${id}-trigger`;
  trigger.className = 'paragraph-select-trigger';
  if (select.matches('.code-language')) trigger.classList.add('code-language-trigger');
  else if (id !== 'block-type') trigger.classList.add('settings-select-trigger');
  trigger.type = 'button';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', `${id}-listbox`);
  const label = select.closest('label')?.querySelector('span') || document.querySelector(`label[for="${id}"]`);
  if (label) {
    label.id = label.id || `${id}-label`;
    if (label.tagName === 'LABEL') label.htmlFor = trigger.id;
    trigger.setAttribute('aria-labelledby', label.id);
  }
  const value = document.createElement('span');
  value.className = 'paragraph-select-value';
  const chevron = document.createElement('span');
  chevron.className = 'paragraph-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  trigger.append(value, chevron);
  const menu = document.createElement('div');
  menu.id = `${id}-listbox`;
  menu.className = 'paragraph-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('popover', 'manual');
  if (label) menu.setAttribute('aria-labelledby', label.id);
  else menu.setAttribute('aria-labelledby', trigger.id);
  let items = [];
  function rebuild() {
  menu.replaceChildren();
  items = [...select.options].map((option, index) => {
    const item = document.createElement('div');
    item.id = `${id}-option-${index}`;
    item.className = 'paragraph-select-option';
    item.setAttribute('role', 'option');
    item.dataset.value = option.value;
    const text = document.createElement('span');
    text.className = 'paragraph-select-option-label';
    const check = document.createElement('span');
    check.className = 'paragraph-select-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    item.append(text, check);
    item.addEventListener('pointermove', () => highlight(index));
    item.addEventListener('click', () => commit(index));
    menu.append(item);
    return item;
  });
  }
  rebuild();
  select.hidden = true;
  select.after(trigger);
  (select.closest('dialog') || document.body).append(menu); // Modal descendants are not inert.
  let active = 0;
  let openedValue = null;
  let typeahead = '';
  let typedAt = 0;
  const isOpen = () => menu.matches(':popover-open');
  const available = () => !select.disabled && trigger.checkVisibility();
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  function close() {
    if (isOpen()) menu.hidePopover();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    typeahead = '';
  }
  function highlight(index) {
    if (select.options[index]?.disabled) return;
    active = index;
    items.forEach((item, i) => item.classList.toggle('is-active', i === index));
    if (isOpen()) {
      trigger.setAttribute('aria-activedescendant', items[index].id);
      items[index].scrollIntoView({ block: 'nearest' });
    }
  }
  function position() {
    if (!isOpen()) return;
    if (!available()) { close(); return; }
    const rect = trigger.getBoundingClientRect();
    const gap = 5, edge = 8;
    const width = Math.min(Math.max(rect.width, select.matches('.code-language') ? 220 : 0), innerWidth - edge * 2);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.max(edge, Math.min(rect.left, innerWidth - width - edge))}px`;
    const below = innerHeight - rect.bottom - gap - edge;
    const above = rect.top - gap - edge;
    const useAbove = below < Math.min(menu.scrollHeight + 2, 270) && above > below;
    menu.style.maxHeight = `${Math.max(0, Math.min(320, useAbove ? above : below))}px`;
    menu.style.top = `${useAbove ? Math.max(edge, rect.top - gap - menu.getBoundingClientRect().height) : rect.bottom + gap}px`;
  }
  function sync() {
    if (items.length !== select.options.length || items.some((item, i) => item.dataset.value !== select.options[i].value)) rebuild();
    trigger.disabled = select.disabled;
    if (!label) trigger.setAttribute('aria-label', document.documentElement.lang === 'en' ? 'Code language' : '代码语言');
    setText(value, select.selectedOptions[0]?.textContent || '');
    items.forEach((item, index) => {
      const option = select.options[index];
      setText(item.firstElementChild, option.textContent);
      item.setAttribute('aria-selected', String(option.selected));
      item.setAttribute('aria-disabled', String(option.disabled));
    });
    // A caret move / undo / file switch must never leave a stale pending choice.
    if (isOpen() && (!available() || select.value !== openedValue)) close();
  }
  function open() {
    sync();
    if (!available()) return;
    openedValue = select.value;
    menu.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    position();
    highlight(Math.max(0, select.selectedIndex));
    trigger.focus({ preventScroll: true });
  }
  function commit(index) {
    if (!isOpen() || !available() || select.options[index].disabled) return;
    close();
    select.value = select.options[index].value;
    // Existing handler focuses Tiptap, whose selection is retained while the UI owns focus.
    select.dispatchEvent(new Event('change', { bubbles: true }));
    sync();
  }
  // Do not let a menu click collapse the editor's text selection.
  menu.addEventListener('mousedown', event => event.preventDefault());
  trigger.addEventListener('mousedown', event => event.preventDefault());
  trigger.addEventListener('click', () => isOpen() ? close() : open());
  trigger.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') {
      if (isOpen()) { event.preventDefault(); event.stopPropagation(); close(); }
      return;
    }
    const wasOpen = isOpen();
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!wasOpen) open();
      else if (event.key === 'Enter' || event.key === ' ') { commit(active); return; }
      if (event.key === 'Home') highlight(0);
      else if (event.key === 'End') highlight(items.length - 1);
      else if (wasOpen && event.key.startsWith('Arrow')) {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        let next = active + direction;
        while (next >= 0 && next < items.length && select.options[next].disabled) next += direction;
        if (next >= 0 && next < items.length) highlight(next);
      }
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (!wasOpen) open();
      const now = Date.now();
      typeahead = now - typedAt > 700 ? event.key : typeahead + event.key;
      typedAt = now;
      const index = [...select.options].findIndex(option => !option.disabled && option.textContent.toLocaleLowerCase().startsWith(typeahead.toLocaleLowerCase()));
      if (index >= 0) highlight(index);
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!trigger.contains(event.target) && !menu.contains(event.target)) close();
  }, { capture: true, signal });
  document.addEventListener('focusin', event => {
    if (!trigger.contains(event.target) && !menu.contains(event.target)) close();
  }, { signal });
  window.addEventListener('blur', close, { signal });
  window.addEventListener('resize', position, { signal });
  select.closest('dialog')?.addEventListener('close', close, { signal });
  document.addEventListener('scroll', event => {
    if (isOpen() && !menu.contains(event.target)) close();
  }, { capture: true, signal });
  select.addEventListener('change', sync, { signal });
  select.addEventListener('paragraph-style-sync', sync, { signal });
  // NodeView undo and settings write properties, which MutationObserver cannot see.
  const descriptors = ['value', 'selectedIndex'].map(name => [name, Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, name)]);
  for (const [name, descriptor] of descriptors) Object.defineProperty(select, name, {
    configurable: true, get() { return descriptor.get.call(this); },
    set(value) { descriptor.set.call(this, value); sync(); }
  });
  for (const type of ['pointerdown', 'mousedown', 'click', 'keydown']) menu.addEventListener(type, event => event.stopPropagation());
  trigger.addEventListener('click', event => event.stopPropagation());
  const observer = new MutationObserver(sync);
  observer.observe(select, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  for (const panel of document.querySelectorAll('#editor-tools, #editor-panel-body')) {
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class'] });
  }
  sync();
  adapters.set(select, () => {
    close(); controller.abort(); observer.disconnect(); menu.remove(); trigger.remove();
    for (const [name] of descriptors) delete select[name];
    adapters.delete(select);
  });
  }
  function scan() {
    for (const [select, destroy] of adapters) if (!select.isConnected) destroy();
    document.querySelectorAll('#block-type, #ui-language, #theme, #editor-content select.code-language').forEach(install);
  }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
