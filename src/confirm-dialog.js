(() => {
  const api = window.mdview;
  if (!api?.onUnsavedConfirm || document.querySelector('#unsaved-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'unsaved-dialog';
  dialog.setAttribute('aria-labelledby', 'unsaved-title');
  dialog.setAttribute('aria-describedby', 'unsaved-name unsaved-description');
  dialog.setAttribute('aria-modal', 'true');
  // Static chrome only; filenames are always assigned as text, never parsed HTML.
  dialog.innerHTML = `<div class="unsaved-heading"><h2 id="unsaved-title"></h2><button type="button" class="unsaved-x" data-choice="cancel" aria-label="取消">×</button></div><div class="unsaved-body"><p id="unsaved-name" dir="auto"></p><p id="unsaved-description"></p></div><div class="unsaved-actions"><button type="button" data-choice="discard"></button><span></span><button type="button" data-choice="cancel" autofocus></button><button type="button" data-choice="save" class="primary"></button></div>`;
  document.body.append(dialog);
  let current = null;
  let previousFocus = null;
  let lastFocus = document.activeElement;
  let restoreTarget = null;
  let busy = false;
  document.addEventListener('focusin', event => {
    if (event.target !== document.body && !dialog.contains(event.target)) lastFocus = event.target;
  });
  const restoreFocus = () => {
    if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
    restoreTarget = null;
  };
  api.onBusy(value => {
    busy = value;
    // The renderer has now made the editor editable again. Restoring while the
    // save/close barrier is held would leave focus on body instead of the editor.
    if (!value && !current) restoreFocus();
  });
  const cancel = dialog.querySelector('[autofocus]');
  const dismiss = () => {
    current = null;
    if (dialog.open) dialog.close();
    restoreTarget = previousFocus;
    previousFocus = null;
    if (!busy) restoreFocus();
  };
  const answer = choice => {
    if (!current) return;
    const id = current;
    dismiss();
    api.answerUnsavedConfirm(id, choice);
  };
  dialog.addEventListener('click', event => {
    const button = event.target.closest('button[data-choice]');
    if (button) answer(button.dataset.choice);
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); answer('cancel'); });
  dialog.addEventListener('close', () => { if (current && !dialog.open) answer('cancel'); });
  dialog.addEventListener('keydown', event => {
    // Prevent document shortcuts underneath this modal; Tab stays in the dialog.
    event.stopPropagation();
    if (event.key !== 'Tab') return;
    const buttons = [...dialog.querySelectorAll('button')].filter(button => !button.hidden);
    const index = buttons.indexOf(document.activeElement);
    event.preventDefault();
    buttons[(index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
  });
  api.onUnsavedConfirm(question => {
    if (!question || typeof question.id !== 'string' || typeof question.name !== 'string') return;
    if (current) { api.answerUnsavedConfirm(question.id, 'cancel'); return; }
    const english = question.language === 'en';
    const trash = question.kind === 'trash';
    dialog.dataset.kind = trash ? 'trash' : 'save';
    dialog.querySelector('[data-choice="save"]').hidden = trash;
    dialog.querySelector('#unsaved-title').textContent = trash ? (english ? `Delete ${question.files.length} file(s)?` : `删除 ${question.files.length} 个文件？`) : (english ? 'Save changes?' : '保存修改？');
    const name = dialog.querySelector('#unsaved-name');
    name.textContent = trash ? question.files.map(file => `${file.dirty ? '● ' : ''}${file.path}`).join('\n') : question.name;
    name.title = name.textContent;
    dialog.querySelector('#unsaved-description').textContent = trash ? (english ? 'Move these disk files to the Recycle Bin and close their tabs. Unsaved edits (●) will be discarded, not saved. This is not just closing tabs.' : '将这些磁盘文件移入回收站并关闭标签。未保存的修改（●）将被丢弃，不会自动保存。这不只是关闭标签。') : (english ? 'This document has unsaved changes. If you don’t save, these changes will be lost.' : '此文档有未保存的修改。如果不保存，这些修改将会丢失。');
    for (const button of dialog.querySelectorAll('[data-choice]')) {
      const label = ({ save: english ? 'Save' : '保存', discard: trash ? (english ? 'Move to Recycle Bin' : '移入回收站') : (english ? 'Don’t save' : '不保存'), cancel: english ? 'Cancel' : '取消' })[button.dataset.choice];
      if (button.classList.contains('unsaved-x')) button.setAttribute('aria-label', label);
      else button.textContent = label;
    }
    previousFocus = lastFocus?.isConnected ? lastFocus : document.activeElement;
    current = question.id;
    try { dialog.showModal(); cancel.focus({ preventScroll: true }); }
    catch { answer('cancel'); }
  });
  api.onUnsavedConfirmDismiss(id => { if (id === current) dismiss(); });
})();
