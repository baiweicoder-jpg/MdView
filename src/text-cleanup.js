/* Conservative, preview-first prose cleanup. All edits stay in editor history. */
(() => {
  const section = document.createElement('section');
  section.className = 'inspector-section';
  section.innerHTML = '<h2>文本清理</h2><div class="format-grid"><button type="button" data-cleanup="lines">删除换行</button><button type="button" data-cleanup="blank">删除空白行</button><button type="button" data-cleanup="spaces">清理多余空格</button></div><p class="settings-note">优先处理选区，否则处理当前文档。执行前预览范围和修改数。</p>';
  $('#editor-panel-body').insertBefore(section, $('.inspector-help'));
  const dialog = document.createElement('dialog');
  dialog.id = 'text-cleanup-dialog';
  dialog.setAttribute('aria-labelledby', 'text-cleanup-title');
  dialog.setAttribute('aria-describedby', 'text-cleanup-description');
  dialog.innerHTML = '<h2 id="text-cleanup-title"></h2><p id="text-cleanup-scope"></p><p id="text-cleanup-description"></p><p id="text-cleanup-count" role="status"></p><div class="editor-actions"><button id="text-cleanup-cancel" type="button" autofocus>取消</button><button id="text-cleanup-apply" type="button">确认清理</button></div>';
  document.body.append(dialog);
  let pending, owner, id, focus;
  const explanations = {
    lines: '仅合并相邻的普通正文段落，英文之间保留分隔空格。保留显式硬换行；标题、列表、引用、表格、代码及含链接或图片的段落不合并。',
    blank: '仅删除普通正文中的空段落或空白段落。保留 Markdown 必需的段落分隔，以及标题、列表、引用、表格和代码内部的空行。',
    spaces: '仅合并正文中重复的半角空格并清理段落边缘空格。保留单个空格、序号、英文、数字单位、缩进、硬换行、代码、链接及图片；无法可靠判断所有语义空格，不会删除全部空格。',
  };
  function sync() { for (const button of section.querySelectorAll('button')) button.disabled = !editing || fileBusy || !richEditor?.editor.isEditable; }
  section.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  section.addEventListener('click', event => {
    const button = event.target.closest('[data-cleanup]');
    if (!button) return;
    sync();
    if (button.disabled || restoringView || document.querySelector('dialog[open]')) return;
    owner = richEditor; id = currentDocument.id; focus = document.activeElement;
    pending = owner.planCleanup(button.dataset.cleanup);
    $('#text-cleanup-title').textContent = t({lines:'删除换行',blank:'删除空白行',spaces:'清理多余空格'}[button.dataset.cleanup]);
    $('#text-cleanup-scope').textContent = t(pending.scope === 'selection' ? '范围：选中的文本' : '范围：整个当前文档') + ' · ' + (currentDocument.name || t('未命名.md'));
    $('#text-cleanup-description').textContent = t(explanations[button.dataset.cleanup]);
    $('#text-cleanup-count').textContent = t('预计修改 {count} 处；可一次撤销，不自动保存。', {count:pending.count});
    $('#text-cleanup-apply').disabled = !pending.count;
    window.mdview.menuState({shortcutHelpOpen:true});
    dialog.showModal(); $('#text-cleanup-cancel').focus();
  });
  $('#text-cleanup-cancel').addEventListener('click', () => dialog.close());
  $('#text-cleanup-apply').addEventListener('click', () => {
    if (!fileBusy && editing && owner === richEditor && currentDocument?.id === id && pending) owner.applyCleanup(pending);
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    pending = null; owner = null;
    window.mdview.menuState({shortcutHelpOpen:false});
    if (!fileBusy && focus?.isConnected) focus.focus({preventScroll:true});
  });
  // Cancel a stale preview rather than applying a plan to a changed document.
  document.addEventListener('document-search-update', () => {
    sync();
    if (dialog.open && (owner !== richEditor || currentDocument?.id !== id || owner.editor.state.doc !== pending?.doc || !editing)) dialog.close();
  });
  window.mdview.onBusy(() => { sync(); if (dialog.open && fileBusy) dialog.close(); });
  sync();
})();
