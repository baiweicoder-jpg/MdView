const $ = selector => document.querySelector(selector);
const reader = $('#reader');
const codeDialog = $('#code-dialog');
let codeDialogTrigger;
const themeNames = { light: '浅色', dark: '深色', warm: '暖纸' };
const media = matchMedia('(prefers-color-scheme: dark)');
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem('mdview-preferences') || '{}') || {}; } catch {}
let fontSize = Number.isInteger(preferences.fontSize) ? Math.max(13, Math.min(24, preferences.fontSize)) : 16;
$('#theme').value = ['system', 'light', 'dark', 'warm'].includes(preferences.theme) ? preferences.theme : 'system';
function savePreferences() {
  try { localStorage.setItem('mdview-preferences', JSON.stringify({ theme: $('#theme').value, fontSize })); } catch {}
}
function applyTheme() {
  const selected = $('#theme').value;
  const theme = selected === 'system' ? (media.matches ? 'dark' : 'light') : selected;
  document.documentElement.dataset.theme = theme;
  $('#theme-status').textContent = themeNames[theme];
  savePreferences();
}
function applyFont() {
  document.documentElement.style.setProperty('--reading-size', `${fontSize}px`);
  $('#font-size').textContent = fontSize;
  $('#font-down').disabled = fontSize <= 13;
  $('#font-up').disabled = fontSize >= 24;
  savePreferences();
}
function changeFont(delta) {
  fontSize = Math.max(13, Math.min(24, fontSize + delta));
  applyFont();
}
function changeCodeZoom(block, direction) {
  const percent = direction === 0 ? 100 : Math.max(70, Math.min(200, Number(block.dataset.codeZoom || 100) + direction * 10));
  block.dataset.codeZoom = percent;
  block.style.setProperty('--code-scale', percent / 100);
  block.querySelector('.code-zoom-reset').textContent = `${percent}%`;
  block.querySelector('[data-code-zoom="-1"]').disabled = percent === 70;
  block.querySelector('[data-code-zoom="1"]').disabled = percent === 200;
}
function openCodeDialog(button) {
  const clone = button.closest('.code-block').cloneNode(true);
  clone.querySelector('.expand-code').remove();
  $('#code-dialog-title').textContent = `单独查看 · ${clone.querySelector('.code-language').textContent}`;
  $('#code-dialog-content').replaceChildren(clone);
  $('#code-dialog-status').textContent = '';
  codeDialogTrigger = button;
  codeDialog.showModal();
}
$('#close-code-dialog').addEventListener('click', () => codeDialog.close());
codeDialog.addEventListener('close', () => {
  $('#code-dialog-content').replaceChildren();
  if (codeDialogTrigger?.isConnected) codeDialogTrigger.focus({ preventScroll: true });
  codeDialogTrigger = null;
});
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 2300);
}
async function perform(action) {
  try { await action(); } catch { toast('操作未完成，请重试。'); }
}
$('#theme').addEventListener('change', applyTheme);
media.addEventListener('change', applyTheme);
$('#font-down').addEventListener('click', () => changeFont(-1));
$('#font-up').addEventListener('click', () => changeFont(1));
document.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  if (!event.deltaY) return;
  const direction = -Math.sign(event.deltaY);
  if (codeDialog.open) changeCodeZoom(codeDialog.querySelector('.code-block'), direction);
  else changeFont(direction);
}, { passive: false });
$('#open').addEventListener('click', () => perform(() => window.mdview.open()));
$('#new').addEventListener('click', () => perform(() => window.mdview.newDocument()));
$('#settings').addEventListener('click', () => perform(async () => {
  const settings = await window.mdview.getSettings();
  $('#save-directory').textContent = settings.saveDirectory;
  $('#settings-error').hidden = true;
  $('#settings-dialog').showModal();
}));
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close());
async function changeSaveDirectory(reset) {
  $('#choose-save-directory').disabled = $('#reset-save-directory').disabled = true;
  $('#settings-error').hidden = true;
  try {
    const settings = await (reset ? window.mdview.resetSaveDirectory() : window.mdview.chooseSaveDirectory());
    $('#save-directory').textContent = settings.saveDirectory;
  } catch {
    $('#settings-error').textContent = '无法保存设置，请检查文件夹权限后重试。';
    $('#settings-error').hidden = false;
  } finally { $('#choose-save-directory').disabled = $('#reset-save-directory').disabled = false; }
}
$('#choose-save-directory').addEventListener('click', () => changeSaveDirectory(false));
$('#reset-save-directory').addEventListener('click', () => changeSaveDirectory(true));
$('#reload').addEventListener('click', () => perform(() => window.mdview.reload()));
function toggleOutline() {
  const hidden = document.body.classList.toggle('outline-hidden');
  $('#toggle-outline').setAttribute('aria-expanded', String(!hidden));
}
$('#toggle-outline').addEventListener('click', toggleOutline);
window.mdview.onToggleOutline(toggleOutline);
let observer;
let currentPath;
let currentDocument;
let richEditor;
let editing = false;
let fileBusy = false;
window.mdview.onDocument(result => {
  if (result.ok) {
    richEditor?.destroy(); richEditor = null; editing = false;
    currentDocument = result.document; setEditingUI();
  }
  renderDocument(result);
  if (result.ok && result.edit) {
    richEditor = MdViewRich.create($('#editor-content'), currentDocument, changed);
    editing = true; setEditingUI();
    richEditor.editor.commands.focus();
  }
});
function renderDocument(result) {
  if (!result.ok) {
    $('#notice').textContent = result.message;
    $('#notice').hidden = false;
    return;
  }
  const doc = result.document;
  if (codeDialog.open) codeDialog.close();
  const previousScroll = currentPath === doc.path ? reader.scrollTop : 0;
  currentPath = doc.path;
  $('#content').innerHTML = doc.html;
  $('#file-name').textContent = doc.name;
  $('#file-path').textContent = doc.path || '尚未保存 · Ctrl+S 选择文件名并保存';
  $('#file-path').title = doc.path;
  $('#document-status').textContent = `${doc.characters.toLocaleString()} 字符 · ${doc.headings.length} 个章节`;
  $('#heading-count').textContent = doc.headings.length;
  $('#notice').textContent = doc.warnings.join(' ');
  $('#notice').hidden = !doc.warnings.length;
  const outline = $('#outline');
  outline.replaceChildren();
  const baseLevel = Math.min(6, ...doc.headings.map(heading => heading.level));
  for (const heading of doc.headings) {
    const link = document.createElement('a');
    link.href = `#${encodeURIComponent(heading.id)}`;
    link.textContent = heading.title;
    link.title = heading.title;
    link.dataset.target = heading.id;
    link.style.paddingLeft = `${16 + Math.min(3, heading.level - baseLevel) * 14}px`;
    outline.append(link);
  }
  if (!doc.headings.length) outline.textContent = '这份文档没有标题';
  observer?.disconnect();
  observer = new IntersectionObserver(entries => {
    const visible = entries.find(entry => entry.isIntersecting);
    if (!visible) return;
    for (const link of outline.querySelectorAll('a')) {
      const active = link.dataset.target === visible.target.id;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
  }, { root: reader, rootMargin: '0px 0px -65% 0px' });
  for (const heading of $('#content').querySelectorAll('h1,h2,h3,h4,h5,h6')) observer.observe(heading);
  reader.scrollTop = previousScroll;
}
document.addEventListener('click', event => {
  const expand = event.target.closest('.expand-code');
  if (expand) { openCodeDialog(expand); return; }
  const zoom = event.target.closest('button[data-code-zoom]');
  if (zoom) {
    changeCodeZoom(zoom.closest('.code-block'), Number(zoom.dataset.codeZoom));
    return;
  }
  const copy = event.target.closest('.copy-code');
  if (copy) {
    perform(async () => {
      await window.mdview.copy(copy.closest('.code-block').querySelector('code').textContent);
      if (codeDialog.open) {
        $('#code-dialog-status').textContent = '代码已复制';
        copy.textContent = '已复制';
        setTimeout(() => { copy.textContent = '复制'; }, 1600);
      } else toast('代码已复制');
    });
    return;
  }
  const link = event.target.closest('a');
  if (!link) return;
  if (link.closest('#editor-content')) { event.preventDefault(); return; }
  event.preventDefault();
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {
    try {
      const id = decodeURIComponent(href.slice(1));
      const target = editing ? [...$('#editor-content').querySelectorAll('h1,h2,h3,h4,h5,h6')].find(element => element.textContent === link.textContent) : [...$('#content').querySelectorAll('[id]')].find(element => element.id === id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch { toast('无法定位此章节'); }
  } else if (/^https?:\/\//i.test(href)) perform(() => window.mdview.external(href));
  else toast('首版仅支持文内目录和网页链接；其他文档请通过打开文件读取。');
});
let dragDepth = 0;
document.addEventListener('dragenter', event => {
  event.preventDefault();
  if (event.dataTransfer.types.includes('Files')) { dragDepth++; $('#drop-overlay').hidden = false; }
});
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('dragleave', event => {
  event.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; }
});
document.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  const files = [...event.dataTransfer.files];
  const file = files.find(item => /\.(md|markdown)$/i.test(item.name));
  if (file) perform(() => window.mdview.drop(file));
  else toast('请拖入 .md 或 .markdown 文件');
});
applyTheme();
applyFont();

function payload() { return { id: currentDocument.id, source: richEditor ? richEditor.source() : currentDocument.source }; }
function setEditingUI() {
  $('#editor-content').hidden = !editing;
  $('#editor-tools').hidden = !editing;
  $('#content').hidden = editing;
  $('.end-mark').hidden = editing;
  $('#edit').textContent = editing ? '完成编辑' : '编辑';
  const dirty = currentDocument && payload().source !== currentDocument.source;
  $('#edit-status').textContent = dirty ? '未保存' : editing ? '编辑中' : '';
}
function changed() { window.mdview.draft(payload()); setEditingUI(); }
async function toggleEditing() {
  if (!currentDocument || fileBusy) return;
  if (codeDialog.open) codeDialog.close();
  if (!richEditor) richEditor = MdViewRich.create($('#editor-content'), currentDocument, changed);
  if (editing) {
    const doc = await window.mdview.preview(payload());
    renderDocument({ ok: true, document: doc });
  }
  editing = !editing; setEditingUI();
  if (editing) richEditor.editor.commands.focus();
}
async function saveDocument(asNew = false) {
  if (!currentDocument || fileBusy) return;
  const result = await window.mdview.save({ ...payload(), asNew });
  if (!result.ok && !result.canceled) { $('#notice').textContent = result.message; $('#notice').hidden = false; }
}
$('#edit').addEventListener('click', () => perform(toggleEditing));
$('#save').addEventListener('click', () => perform(() => saveDocument()));
$('#save-as').addEventListener('click', () => perform(() => saveDocument(true)));
window.mdview.onToggleEdit(() => perform(toggleEditing));
window.mdview.onSaveRequest(asNew => perform(() => saveDocument(asNew)));
window.mdview.onEditError(message => { $('#notice').textContent = message; $('#notice').hidden = false; });
window.mdview.onBusy(value => {
  fileBusy = value;
  richEditor?.editor.setEditable(!value, false);
  for (const id of ['new', 'open', 'reload', 'edit', 'save', 'save-as']) $('#' + id).disabled = value;
});
window.addEventListener('beforeunload', event => {
  if (currentDocument && payload().source !== currentDocument.source) { event.preventDefault(); event.returnValue = ''; }
});
window.mdview.onSaved(result => {
  if (result.id !== currentDocument.id) return;
  currentDocument = { ...currentDocument, ...result };
  richEditor?.saved(result.snapshot, result.source);
  $('#file-name').textContent = result.name;
  $('#file-path').textContent = result.path;
  $('#file-path').title = result.path;
  setEditingUI(); toast('已保存');
});
$('#editor-tools').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
$('#editor-tools').addEventListener('click', event => {
  const action = event.target.closest('[data-edit]')?.dataset.edit;
  if (!action || !richEditor) return;
  const chain = richEditor.editor.chain().focus();
  if (action === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  else chain[action]().run();
});
$('#block-type').addEventListener('change', event => {
  const level = Number(event.target.value), chain = richEditor.editor.chain().focus();
  if (level) chain.setHeading({ level }).run(); else chain.setParagraph().run();
});
