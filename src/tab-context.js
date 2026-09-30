(() => {
  const api = window.mdview, bar = document.querySelector('#tab-bar');
  const dialog = document.createElement('dialog');
  dialog.id = 'rename-dialog';
  dialog.setAttribute('aria-labelledby', 'rename-title');
  dialog.setAttribute('aria-describedby', 'rename-hint');
  dialog.innerHTML = `<form><header><h2 id="rename-title"></h2><button class="rename-x" type="button" data-cancel>×</button></header><div class="rename-body"><label for="rename-name"></label><input id="rename-name" type="text" maxlength="255" autocomplete="off" spellcheck="false" aria-describedby="rename-hint rename-error"><p id="rename-hint"></p><p id="rename-error" role="alert" hidden></p></div><footer><button type="button" data-cancel></button><button type="submit" class="primary"></button></footer></form>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input');
  let question = null, restoreTarget = null, lastFocus = document.activeElement;
  document.addEventListener('focusin', event => { if (!dialog.contains(event.target) && event.target !== document.body) lastFocus = event.target; });
  function dismiss() { question = null; if (dialog.open) dialog.close(); }
  function answer(name) {
    if (!question) return;
    const id = question.id;
    dismiss(); api.answerRename(id, name);
  }
  dialog.querySelector('form').addEventListener('submit', event => { event.preventDefault(); answer(input.value); });
  dialog.addEventListener('click', event => { if (event.target.closest('[data-cancel]')) answer(null); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); answer(null); });
  dialog.addEventListener('close', () => { if (question && !dialog.open) answer(null); });
  // Capture before document/editor shortcut handlers (including image Escape).
  window.addEventListener('keydown', event => {
    if (!dialog.open) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); answer(null); }
    else if (event.key === 'Enter' && event.target === input && !event.isComposing) { event.preventDefault(); answer(input.value); }
  }, true);
  api.onRenameQuestion(value => {
    if (question || document.querySelector('dialog[open]')) { api.answerRename(value.id, null); return; }
    if (!restoreTarget) restoreTarget = lastFocus;
    const en = value.language === 'en';
    dialog.querySelector('h2').textContent = en ? 'Rename file' : '重命名文件';
    dialog.querySelector('label').textContent = en ? 'File name' : '文件名';
    dialog.querySelector('#rename-hint').textContent = en ? 'Keep .md or .markdown. Renames the file in its current folder; unsaved edits stay unsaved.' : '保留 .md 或 .markdown 扩展名。在原文件夹重命名；未保存的修改仍保留为草稿。';
    for (const button of dialog.querySelectorAll('[data-cancel]')) {
      button.title = en ? 'Cancel' : '取消'; button.setAttribute('aria-label', button.title);
      if (!button.classList.contains('rename-x')) button.textContent = button.title;
    }
    dialog.querySelector('[type=submit]').textContent = en ? 'Rename' : '重命名';
    const error = dialog.querySelector('#rename-error'); error.textContent = value.error || ''; error.hidden = !value.error;
    input.value = value.name;
    input.setAttribute('aria-invalid', String(Boolean(value.error)));
    question = value;
    try { dialog.showModal(); input.focus(); input.setSelectionRange(0, Math.max(0, value.name.lastIndexOf('.'))); }
    catch { answer(null); }
  });
  api.onRenameDismiss(id => { if (question?.id === id) dismiss(); });
  api.onBusy(value => {
    if (!value && restoreTarget) {
      if (restoreTarget.isConnected) restoreTarget.focus({ preventScroll: true });
      else bar.querySelector('.tab.active')?.focus({ preventScroll: true });
      restoreTarget = null;
    }
  });
  async function popup(tab, point) {
    if (fileBusy || document.querySelector('dialog[open]')) return;
    const id = Number(tab.dataset.id);
    try {
      const action = await api.popupTabMenu({ id, point });
      if (!action) return;
      const result = await api.tabFileAction({ id, action });
      if (!result.ok && !result.canceled) { $('#notice').textContent = result.message; $('#notice').hidden = false; }
    } catch { toast('操作未完成，请重试。'); }
  }
  // Delegate from stable containers: sidebar.js mounts/rebuilds its file rows
  // after this module loads. Both surfaces send only the existing stable tab ID.
  for (const [container, selector] of [[bar, '.tab'], [document.querySelector('#sidebar'), '#opened-files-list .sidebar-file']]) {
    container?.addEventListener('contextmenu', event => {
      const tab = event.target.closest(selector);
      if (!tab) return;
      event.preventDefault(); event.stopPropagation();
      void popup(tab, {x:event.clientX, y:event.clientY});
    });
    container?.addEventListener('keydown', event => {
      const tab = event.target.closest(selector);
      if (!tab || event.target.closest('.tab-close')) return;
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); event.stopPropagation();
        const rect = tab.getBoundingClientRect(); void popup(tab, { x:rect.left, y:rect.bottom });
      } else if (container === bar && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); tab.click(); }
      // Sidebar rows are native buttons; keep their normal activation behavior.
    });
  }
  api.onRenamed(value => {
    if (scrollByPath.has(value.oldPath)) { scrollByPath.set(value.path, scrollByPath.get(value.oldPath)); scrollByPath.delete(value.oldPath); }
    if (currentDocument?.id !== value.id) return;
    // Metadata only. Never remount the editor or mark its unsaved draft as saved.
    Object.assign(currentDocument, {path:value.path, name:value.name});
    if (displayedDocument) Object.assign(displayedDocument, {path:value.path, name:value.name});
    currentPath = value.path;
    $('#file-name').textContent = $('#file-name').title = value.name;
    $('#file-path').textContent = $('#file-path').title = value.path;
  });
})();
