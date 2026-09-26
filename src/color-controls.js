/* Loaded after renderer.js. This is deliberately not an HTML/style whitelist. */
(() => {
  const valid = color => typeof color === 'string' && /^#[\da-f]{6}$/i.test(color);
  const panel = document.querySelector('#editor-panel-body');
  if (!panel || document.querySelector('#color-controls')) return;
  const section = document.createElement('section');
  section.id = 'color-controls';
  section.className = 'inspector-section';
  section.innerHTML = '<h2>颜色</h2><div class="color-control"><label for="highlight-color">高亮颜色</label><input id="highlight-color" type="color" value="#f3df88" aria-label="高亮颜色"><button id="reset-highlight-color" type="button" title="清除高亮">清除</button></div><div class="color-control"><label for="text-color">文字颜色</label><input id="text-color" type="color" value="#30384b" aria-label="文字颜色"><button id="reset-text-color" type="button" title="恢复默认文字颜色">默认</button></div>';
  panel.querySelector('.inspector-section')?.after(section);
  if (typeof translateChrome === 'function') translateChrome(section);
  const controls = [
    { input: section.querySelector('#highlight-color'), reset: section.querySelector('#reset-highlight-color'), mark: 'highlight', set: 'setHighlightColor', unset: 'unsetHighlight', fallback: '#f3df88' },
    { input: section.querySelector('#text-color'), reset: section.querySelector('#reset-text-color'), mark: 'textColor', set: 'setTextColor', unset: 'unsetTextColor', fallback: '#30384b' },
  ];
  let editor = null;
  let bookmark = null;
  const available = () => editor && !editor.isDestroyed && editor.isEditable && typeof editing !== 'undefined' && editing && !fileBusy;
  function sync() {
    const current = typeof richEditor !== 'undefined' ? richEditor?.editor : null;
    if (current !== editor) {
      if (editor && !editor.isDestroyed) editor.off('transaction', onTransaction);
      editor = current;
      bookmark = null;
      if (editor) editor.on('transaction', onTransaction);
    }
    for (const control of controls) {
      const color = editor && !editor.isDestroyed ? editor.getAttributes(control.mark).color : null;
      const active = !!editor && !editor.isDestroyed && editor.isActive(control.mark);
      control.input.disabled = !available() || !editor.can()[control.set](control.input.value);
      control.reset.disabled = !available() || !editor.can()[control.unset]();
      control.input.dataset.active = String(active);
      // Do not overwrite the native picker's draft while it owns focus.
      if (document.activeElement !== control.input) control.input.value = valid(color) ? color : control.fallback;
      control.reset.dataset.active = String(active);
    }
  }
  function onTransaction({ transaction }) {
    if (bookmark && transaction.selectionSet && editor.view.hasFocus()) bookmark = null;
    if (bookmark && transaction.docChanged) bookmark = bookmark.map(transaction.mapping);
    sync();
  }
  function remember() {
    sync();
    if (available()) bookmark = editor.state.selection.getBookmark();
  }
  function apply(control, reset, preview = false) {
    if (!available()) return;
    if (!reset && !valid(control.input.value)) return;
    const color = control.input.value.toLowerCase();
    if (bookmark) {
      try { editor.view.dispatch(editor.state.tr.setSelection(bookmark.resolve(editor.state.doc))); }
      catch { bookmark = null; return; }
    }
    const chain = preview ? editor.chain() : editor.chain().focus();
    if (reset) chain[control.unset]().run();
    else chain[control.set](color).run();
    bookmark = preview ? editor.state.selection.getBookmark() : null;
    sync();
  }
  for (const control of controls) {
    control.input.addEventListener('pointerdown', remember);
    control.input.addEventListener('focus', remember); // Keyboard/assistive focus too.
    control.input.addEventListener('input', () => apply(control, false, true));
    control.input.addEventListener('change', () => apply(control, false));
    control.reset.addEventListener('pointerdown', remember);
    control.reset.addEventListener('mousedown', event => event.preventDefault());
    control.reset.addEventListener('click', () => apply(control, true));
  }
  // HTML from the reader contains only validated data attributes. Use individual
  // CSSOM writes, never setAttribute('style') or cssText (blocked by our CSP).
  function paintReader() {
    for (const el of document.querySelectorAll('#content mark[data-color], #content span[data-color]')) {
      const color = el.getAttribute('data-color');
      if (valid(color)) el.style[el.tagName === 'MARK' ? 'backgroundColor' : 'color'] = color;
    }
  }
  const readerObserver = new MutationObserver(paintReader);
  readerObserver.observe(document.querySelector('#content'), { childList: true, subtree: true, attributes: true, attributeFilter: ['data-color'] });
  const editorObserver = new MutationObserver(sync);
  editorObserver.observe(document.querySelector('#editor-content'), { childList: true });
  editorObserver.observe(document.querySelector('#editor-tools'), { attributes: true, attributeFilter: ['hidden'] });
  editorObserver.observe(document.querySelector('#block-type'), { attributes: true, attributeFilter: ['disabled'] });
  paintReader();
  sync();
})();
