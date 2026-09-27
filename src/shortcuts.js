(() => {
  const api = window.mdview, catalog = window.MdViewShortcuts;
  const dialog = document.createElement('dialog');
  dialog.id = 'shortcuts-dialog';
  dialog.setAttribute('aria-labelledby', 'shortcuts-title');
  dialog.setAttribute('aria-describedby', 'shortcuts-description');
  dialog.setAttribute('aria-modal', 'true');
  dialog.innerHTML = '<header class="shortcuts-header"><div><h2 id="shortcuts-title"></h2><p id="shortcuts-description"></p></div><button id="shortcuts-close" type="button">×</button></header><div class="shortcuts-search"><input id="shortcuts-filter" type="search" autocomplete="off" spellcheck="false" maxlength="120"><output id="shortcuts-count" role="status" aria-live="polite"></output></div><div id="shortcuts-results" tabindex="0"></div><footer id="shortcuts-footer"></footer>';
  document.body.append(dialog);
  // A renderer reload must release any accelerator lock from its old modal.
  api.menuState({ shortcutHelpOpen: false });
  const input = dialog.querySelector('input'), results = dialog.querySelector('#shortcuts-results');
  const closeButton = dialog.querySelector('button');
  let language = document.documentElement.lang, previousFocus, busy = false;
  const text = values => values[language === 'en' ? 1 : 0];
  const node = (tag, value, className) => { const element = document.createElement(tag); if (value) element.textContent = value; if (className) element.className = className; return element; };
  function render() {
    const words = input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    let count = 0;
    results.replaceChildren();
    for (const [id, group] of Object.entries(catalog.groups)) {
      const entries = catalog.entries.filter(entry => entry.group === id && words.every(word => [...entry.label, ...entry.context, ...entry.keys, ...group].join(' ').toLocaleLowerCase().includes(word)));
      if (!entries.length) continue;
      const section = node('section', '', 'shortcuts-group');
      section.append(node('h3', text(group)));
      const list = node('dl');
      for (const entry of entries) {
        const row = node('div', '', 'shortcut-row'); row.dataset.shortcut = entry.id;
        const label = node('dt', text(entry.label));
        if (text(entry.context)) label.append(node('small', text(entry.context)));
        const keys = node('dd');
        entry.keys.forEach((combo, index) => {
          if (index) keys.append(node('span', '/', 'shortcut-or'));
          const chord = node('span', '', 'shortcut-chord');
          chord.setAttribute('aria-label', combo.replace('Plus', '+'));
          combo.split('+').forEach((key, i) => {
            if (i) { const separator = node('span', '+', 'shortcut-plus'); separator.setAttribute('aria-hidden', 'true'); chord.append(separator); }
            chord.append(node('kbd', key === 'Plus' ? '+' : key));
          });
          keys.append(chord);
        });
        row.append(label, keys); list.append(row); count++;
      }
      section.append(list); results.append(section);
    }
    if (!count) results.append(node('p', text(['没有匹配的快捷键。试试命令名称或 Ctrl、Tab。', 'No matching shortcuts. Try a command name, Ctrl or Tab.']), 'shortcuts-empty'));
    dialog.querySelector('output').textContent = text([`${count} 项`, `${count} commands`]);
    results.scrollTop = 0;
  }
  function translate() {
    dialog.querySelector('h2').textContent = text(['快捷键速查', 'Keyboard shortcuts']);
    dialog.querySelector('#shortcuts-description').textContent = text(['Windows · 按使用场景查找，快捷键不会在此执行。', 'Windows · Find a command by context. This panel is reference only.']);
    const closeLabel = text(['关闭快捷键速查', 'Close keyboard shortcuts']);
    closeButton.setAttribute('aria-label', closeLabel); closeButton.title = closeLabel;
    input.placeholder = text(['筛选命令、按键或使用场景…', 'Filter commands, keys or contexts…']);
    input.setAttribute('aria-label', text(['筛选快捷键', 'Filter shortcuts']));
    results.setAttribute('aria-label', text(['快捷键列表', 'Shortcut list']));
    dialog.querySelector('footer').textContent = text(['鼠标手势 · Ctrl + 滚轮调整正文字号；单独查看代码时仅缩放代码。界面缩放与正文字号独立。', 'Mouse gesture · Ctrl + wheel resizes document text; in the code viewer it resizes only code. Interface zoom is separate.']);
    render();
  }
  function open() {
    if (dialog.open) { input.focus(); return; }
    if (busy || document.querySelector('dialog[open]')) return;
    previousFocus = document.activeElement;
    for (const popover of document.querySelectorAll(':popover-open')) popover.hidePopover();
    input.value = ''; translate(); dialog.showModal(); input.focus();
    api.menuState({ shortcutHelpOpen: true });
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
    api.menuState({ shortcutHelpOpen: false });
    if (!busy) restoreFocus();
  }
  function restoreFocus() {
    if (previousFocus?.isConnected && !document.querySelector('dialog[open]')) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => { if (!dialog.open) api.menuState({ shortcutHelpOpen: false }); });
  input.addEventListener('input', render);
  window.addEventListener('keydown', event => {
    if (!dialog.open) return;
    // Editor image/table menus also capture keys on document. They must never
    // consume Escape/Tab or clear selections underneath this top-layer modal.
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'F1') event.preventDefault();
    else if (event.key === 'Tab') {
      const controls = [closeButton, input, results];
      const index = controls.indexOf(document.activeElement);
      event.preventDefault(); controls[(index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
    }
  }, true);
  // Capture before the document's Ctrl+wheel listener; reading help must not
  // change the document's reading size underneath the modal.
  window.addEventListener('wheel', event => {
    if (dialog.open && event.ctrlKey) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true, passive: false });
  api.onMenuAction(action => { if (action === 'shortcuts') open(); });
  api.onBusy(value => { busy = value; if (value) close(); else if (!dialog.open) restoreFocus(); });
  api.onLanguageChanged(value => { language = value; translate(); });
  api.getSettings().then(settings => { language = settings.language; translate(); });
})();
