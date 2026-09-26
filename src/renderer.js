const $ = selector => document.querySelector(selector);
let uiLanguage = 'zh-CN';
let english = {};
let reverseTranslations = {};
const chromeTranslations = new WeakMap();
function t(key, values = {}) {
  const template = uiLanguage === 'en' ? (english[key] || key) : key;
  return template.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
}
function translateChrome(root = document.body) {
  for (const option of root.querySelectorAll('select.code-language option[value=""]')) option.textContent = t('纯文本');
  // Never walk document text, headings, filenames, paths or editable content.
  const protectedSelector = '#content, #editor-content, #outline a, #file-name, #file-path, #save-directory, .tab-name, .code-language, pre, code';
  const translateText = (node, attribute, value) => {
    const cached = chromeTranslations.get(node) || {};
    const previous = cached[attribute];
    const key = previous?.rendered === value ? previous.key : (reverseTranslations[value.trim()] || value.trim());
    const rendered = value.replace(value.trim(), t(key));
    cached[attribute] = { key, rendered };
    chromeTranslations.set(node, cached);
    return rendered;
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, parent = node.parentElement;
    if (!parent || (parent.closest(protectedSelector) && !parent.closest('.code-toolbar'))) continue;
    if (parent.closest('.code-language')) continue;
    const value = translateText(node, 'text', node.nodeValue);
    if (value !== node.nodeValue) node.nodeValue = value;
  }
  for (const element of root.querySelectorAll('[title], [aria-label]')) {
    if (element.closest(protectedSelector) && !element.closest('.code-toolbar')) continue;
    for (const attribute of ['title', 'aria-label']) {
      if (!element.hasAttribute(attribute)) continue;
      const value = element.getAttribute(attribute), translated = translateText(element, attribute, value);
      if (value !== translated) element.setAttribute(attribute, translated);
    }
  }
}
function applyLanguage(language) {
  uiLanguage = language === 'en' ? 'en' : 'zh-CN';
  document.documentElement.lang = uiLanguage;
  $('#ui-language').value = uiLanguage;
  translateChrome();
  if (currentDocument) {
    $('#file-name').textContent = currentDocument.path ? currentDocument.name : t('未命名.md');
    if (!currentDocument.path) $('#file-path').textContent = t('尚未保存 · Ctrl+S 选择文件名并保存');
  }
  if (displayedDocument) updateDocumentStatus(displayedDocument);
  renderTabs();
  setEditingUI();
  applyTheme();
  if (codeDialog.open) $('#code-dialog-title').textContent = t('单独查看 · {language}', { language: codeDialog.querySelector('.code-language').textContent });
}
async function changeLanguage(language) {
  try { const settings = await window.mdview.setLanguage(language); applyLanguage(settings.language); }
  catch { $('#ui-language').value = uiLanguage; toast(t('无法保存设置，请检查文件夹权限后重试。')); }
}
const reader = $('#reader');
const codeDialog = $('#code-dialog');
let codeDialogTrigger;
const themeNames = { light: '浅色', dark: '深色', warm: '暖纸' };
const media = matchMedia('(prefers-color-scheme: dark)');
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem('mdview-preferences') || '{}') || {}; } catch {}
let fontSize = Number.isInteger(preferences.fontSize) ? Math.max(13, Math.min(24, preferences.fontSize)) : 16;
let toolsCollapsed = preferences.toolsCollapsed === true;
$('#theme').value = ['system', 'light', 'dark', 'warm'].includes(preferences.theme) ? preferences.theme : 'system';
function savePreferences() {
  try { localStorage.setItem('mdview-preferences', JSON.stringify({ theme: $('#theme').value, fontSize, toolsCollapsed })); } catch {}
}
function applyTheme() {
  const selected = $('#theme').value;
  const theme = selected === 'system' ? (media.matches ? 'dark' : 'light') : selected;
  document.documentElement.dataset.theme = theme;
  $('#theme-status').textContent = t(themeNames[theme]);
  savePreferences();
  window.mdview.menuState({ theme: selected });
}
function applyFont() {
  document.documentElement.style.setProperty('--reading-size', `${fontSize}px`);
  $('#font-size').textContent = fontSize;
  $('#font-down').disabled = fontSize <= 13;
  $('#font-up').disabled = fontSize >= 24;
  window.mdview.menuState({ fontSize });
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
  const selector = button.closest('.code-block').querySelector('select.code-language');
  if (selector) {
    const label = document.createElement('span');
    label.className = 'code-language';
    label.textContent = selector.value || 'text';
    clone.querySelector('.code-language').replaceWith(label);
  }
  $('#code-dialog-title').textContent = t('单独查看 · {language}', { language: clone.querySelector('.code-language').textContent });
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
  $('#toast').textContent = t(message);
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
}, { passive: false, capture: true });
async function openSettings() {
  const settings = await window.mdview.getSettings();
  $('#save-directory').textContent = settings.saveDirectory;
  $('#settings-error').hidden = true;
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
}
window.mdview.onMenuAction((action, value) => {
  if (action === 'settings') perform(openSettings);
  else if (action === 'language') perform(() => changeLanguage(value));
  else if (action === 'theme' && ['system', 'light', 'dark', 'warm'].includes(value)) { $('#theme').value = value; applyTheme(); }
  else if (action === 'font') changeFont(value);
  else if (action === 'font-reset') { fontSize = 16; applyFont(); }
});
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

function toggleOutline() {
  const hidden = document.body.classList.toggle('outline-hidden');
  $('#toggle-outline').setAttribute('aria-expanded', String(!hidden));
}
$('#toggle-outline').addEventListener('click', toggleOutline);
window.mdview.onToggleOutline(toggleOutline);
let observer;
let currentPath;
let currentDocument;
let displayedDocument;
function updateDocumentStatus(doc) {
  $('#document-status').textContent = t('{characters} 字符 · {headings} 个章节', { characters: doc.characters.toLocaleString(uiLanguage), headings: doc.headings.length });
}
let richEditor;
let editing = false;
let fileBusy = false;
let tabs = [];
const scrollByPath = new Map();
let restoringView = false;
let viewGeneration = 0;
function rememberWorkspaceView() {
  if (!currentDocument || restoringView) return;
  window.mdview.workspaceView({ id: currentDocument.id, scrollTop: reader.scrollTop, editing });
}
reader.addEventListener('scroll', rememberWorkspaceView, { passive: true });
window.mdview.onTabs(list => { tabs = list; renderTabs(); });
function renderTabs() {
  const bar = $('#tab-bar');
  bar.replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement('div');
    item.className = 'tab' + (tab.active ? ' active' : '') + (tab.dirty ? ' dirty' : '');
    item.dataset.id = tab.id;
    item.setAttribute('role', 'tab');
    item.setAttribute('aria-selected', String(tab.active));
    item.title = tab.path || tab.name;
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tab.path ? tab.name : t('未命名.md');
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.setAttribute('aria-label', t('关闭 {name}', { name: name.textContent }));
    close.textContent = '×';
    item.append(name, close);
    bar.append(item);
  }
}
$('#tab-bar').addEventListener('click', event => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  const id = Number(tab.dataset.id);
  if (event.target.closest('.tab-close')) {
    event.stopPropagation();
    perform(() => closeTab(id));
  } else if (!tab.classList.contains('active')) {
    perform(() => switchToTab(id));
  }
});
async function switchToTab(id) {
  if (fileBusy) return;
  rememberWorkspaceView();
  const result = await window.mdview.switchTab({ id, source: payload().source });
  if (result && result.document) processDocument({ ok: true, document: result.document, edit: result.edit });
}
async function closeTab(id) {
  if (fileBusy) return;
  rememberWorkspaceView();
  await window.mdview.closeTab({ id, source: payload().source });
}
window.mdview.onCloseTabRequest(() => { if (currentDocument) perform(() => closeTab(currentDocument.id)); });
window.mdview.onNextTabRequest(() => {
  const index = tabs.findIndex(tab => tab.active);
  if (index >= 0 && tabs.length > 1) perform(() => switchToTab(tabs[(index + 1) % tabs.length].id));
});
window.mdview.onPreviousTabRequest(() => {
  const index = tabs.findIndex(tab => tab.active);
  if (index >= 0 && tabs.length > 1) perform(() => switchToTab(tabs[(index - 1 + tabs.length) % tabs.length].id));
});
function processDocument(result) {
  // An error only displays a notice; it must not cancel the current document's
  // pending restoration (which owns releasing restoringView).
  const generation = result.ok ? ++viewGeneration : viewGeneration;
  if (result.ok) {
    rememberWorkspaceView();
    restoringView = true;
    richEditor?.destroy(); richEditor = null; editing = false;
    currentDocument = result.document; setEditingUI();
  }
  renderDocument(result);
  if (result.ok && result.edit) {
    createRichEditor();
    editing = true; setEditingUI();
    richEditor.editor.commands.focus();
  }
  if (result.ok) {
    const top = result.document.viewState?.scrollTop ?? scrollByPath.get(result.document.path) ?? 0;
    reader.scrollTo({ top, behavior: 'instant' });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== viewGeneration) return;
      reader.scrollTo({ top, behavior: 'instant' });
      restoringView = false;
      rememberWorkspaceView();
    }));
  }
}
window.mdview.onDocument(processDocument);
function renderDocument(result) {
  if (!result.ok) {
    $('#notice').textContent = result.message;
    $('#notice').hidden = false;
    return;
  }
  const doc = result.document;
  displayedDocument = doc;
  if (codeDialog.open) codeDialog.close();
  if (currentPath && currentPath !== doc.path) scrollByPath.set(currentPath, reader.scrollTop);
  currentPath = doc.path;
  $('#content').innerHTML = doc.html;
  $('#file-name').textContent = doc.path ? doc.name : t('未命名.md');
  $('#file-name').title = $('#file-name').textContent;

  $('#file-path').textContent = doc.path || t('尚未保存 · Ctrl+S 选择文件名并保存');
  $('#file-path').title = doc.path;
  updateDocumentStatus(doc);
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
  reader.scrollTop = scrollByPath.get(doc.path) || 0;
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
  document.body.classList.toggle('is-editing', editing);
  applyToolsPanel();
  $('#editor-content').hidden = !editing;
  $('#editor-tools').hidden = !editing;
  $('#content').hidden = editing;
  $('.end-mark').hidden = editing;
  window.mdview.menuState({ editing });
  const dirty = currentDocument && payload().source !== currentDocument.source;
  $('#edit-status').textContent = dirty ? t('未保存') : editing ? t('编辑中') : '';
  $('#edit-status').classList.toggle('dirty', Boolean(dirty));
  syncEditorTools();
  rememberWorkspaceView();
}
function createRichEditor() {
  richEditor = MdViewRich.create($('#editor-content'), currentDocument, changed);
  richEditor.editor.on('transaction', syncEditorTools);
}
function syncEditorTools() {
  if (!richEditor) return;
  const editor = richEditor.editor;
  const activeTypes = { toggleBold: 'bold', toggleItalic: 'italic', toggleStrike: 'strike', toggleUnderline: 'underline', toggleHighlight: 'highlight', toggleCode: 'code', toggleTaskList: 'taskList', toggleBulletList: 'bulletList', toggleOrderedList: 'orderedList', toggleBlockquote: 'blockquote', toggleCodeBlock: 'codeBlock' };
  for (const button of $('#editor-tools').querySelectorAll('[data-edit]')) {
    const action = button.dataset.edit;
    if (activeTypes[action]) button.setAttribute('aria-pressed', String(editor.isActive(activeTypes[action])));
    button.disabled = fileBusy || !editing || (action === 'table' ? !editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }) : !editor.can()[action]());
  }
  $('#block-type').disabled = fileBusy || !editing;
  $('#block-type').value = String(editor.isActive('heading') ? editor.getAttributes('heading').level : 0);
}
function applyToolsPanel() {
  $('#editor-tools').classList.toggle('collapsed', toolsCollapsed);
  $('#editor-panel-body').hidden = toolsCollapsed;
  $('#toggle-editor-tools').setAttribute('aria-expanded', String(!toolsCollapsed));
  const label = t(toolsCollapsed ? '展开格式面板' : '折叠格式面板');
  $('#toggle-editor-tools').setAttribute('aria-label', label);
  $('#toggle-editor-tools').title = label;
}
$('#toggle-editor-tools').addEventListener('click', () => {
  toolsCollapsed = !toolsCollapsed; applyToolsPanel(); savePreferences();
  $('#toggle-editor-tools').focus({ preventScroll: true });
});
applyToolsPanel();
function changed() { window.mdview.draft(payload()); setEditingUI(); }
async function toggleEditing() {
  if (!currentDocument || fileBusy) return;
  if (codeDialog.open) codeDialog.close();
  if (!richEditor) createRichEditor();
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

window.mdview.onToggleEdit(() => perform(toggleEditing));
window.mdview.onSaveRequest(asNew => perform(() => saveDocument(asNew)));
window.mdview.onEditError(message => { $('#notice').textContent = message; $('#notice').hidden = false; });
window.mdview.onBusy(value => {
  fileBusy = value;
  richEditor?.editor.setEditable(!value, false);

  syncEditorTools();
});
window.addEventListener('beforeunload', event => {
  rememberWorkspaceView();
  if (tabs.some(tab => tab.dirty) || (currentDocument && payload().source !== currentDocument.source)) { event.preventDefault(); event.returnValue = ''; }
});
window.mdview.onSaved(result => {
  if (result.id !== currentDocument.id) return;
  currentDocument = { ...currentDocument, ...result };
  richEditor?.saved(result.snapshot, result.source);
  $('#file-name').textContent = result.name;
  $('#file-name').title = result.name;

  $('#file-path').textContent = result.path;
  $('#file-path').title = result.path;
  setEditingUI(); toast('已保存');
});
$('#editor-tools').addEventListener('mousedown', event => { if (event.target.closest('[data-edit]')) event.preventDefault(); });
$('#editor-tools').addEventListener('click', event => {
  const action = event.target.closest('[data-edit]')?.dataset.edit;
  if (!action || !richEditor || fileBusy || !editing) return;
  const chain = richEditor.editor.chain().focus();
  if (action === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  else chain[action]().run();
});
$('#block-type').addEventListener('change', event => {
  const level = Number(event.target.value), chain = richEditor.editor.chain().focus();
  if (level) chain.setHeading({ level }).run(); else chain.setParagraph().run();
});

// Keep HTML and editor source untouched: add a native select using the existing settings layout.
const languageRow = document.createElement('label');
languageRow.className = 'view-row';
languageRow.htmlFor = 'ui-language';
const languageLabel = document.createElement('span');
languageLabel.textContent = '界面语言';
const languageSelect = document.createElement('select');
languageSelect.id = 'ui-language';
for (const [value, label] of [['zh-CN', '简体中文'], ['en', 'English']]) {
  const option = document.createElement('option');
  option.value = value; option.textContent = label; languageSelect.append(option);
}
languageRow.append(languageLabel, languageSelect);
$('#settings-dialog > header').after(languageRow);
languageSelect.addEventListener('change', () => changeLanguage(languageSelect.value));
window.mdview.onLanguageChanged(applyLanguage);
window.mdview.getI18n().then(resources => {
  english = resources.english;
  reverseTranslations = Object.fromEntries(Object.entries(english).map(([key, value]) => [value, key]));
  applyLanguage(resources.language);
  // Dynamic notices, copy feedback and newly rendered code controls use the same catalog.
  const chromeObserver = new MutationObserver(records => {
    if (records.every(record => (record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement)?.closest('#editor-content, #outline a, pre, code'))) return;
    chromeObserver.disconnect();
    translateChrome();
    observe();
  });
  function observe() { chromeObserver.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'aria-label'] }); }
  observe();
}).catch(() => toast('操作未完成，请重试。'));
