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
  for (const option of root.querySelectorAll('select.code-language option[value=""]')) {
    if (option.textContent !== t('纯文本')) option.textContent = t('纯文本');
  }
  // Never walk document text, headings, filenames, paths or editable content.
  const protectedSelector = '#content, #editor-content, #outline a, #file-name, #file-path, #document-times, #save-directory, #shortcuts-dialog, #rename-dialog, #unsaved-dialog, #document-search-results, #document-search-count, .tab-name, .code-language, pre, code';
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
    if (parent.closest('.code-language, .paragraph-select-menu, .paragraph-select-trigger')) continue;
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
  renderDocumentTimes();
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
const themeNames = { light: '浅色', dark: '深色', warm: '暖纸', review: '审阅纸', sky: '天蓝' };
const media = matchMedia('(prefers-color-scheme: dark)');
let preferences = {};
try { preferences = JSON.parse(localStorage.getItem('mdview-preferences') || '{}') || {}; } catch {}
let fontSize = Number.isInteger(preferences.fontSize) ? Math.max(13, Math.min(24, preferences.fontSize)) : 16;
let toolsCollapsed = preferences.toolsCollapsed === true;
$('#theme').value = ['system', ...Object.keys(themeNames)].includes(preferences.theme) ? preferences.theme : 'system';
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
  // The expanded view is an inert snapshot, not a second editor.
  clone.querySelector('.remove-blank-lines')?.remove();
  clone.contentEditable = 'false';
  const selector = button.closest('.code-block').querySelector('select.code-language');
  if (selector) {
    const label = document.createElement('span');
    label.className = 'code-language';
    label.textContent = selector.value || 'text';
    clone.querySelector('.code-language').replaceWith(label);
    clone.querySelectorAll('.code-language-trigger').forEach(trigger => trigger.remove());
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
  // Dedicated chrome controls own these gestures; leave code/body routing intact.
  if (event.target.closest?.('#sidebar, #menu-bar, #zoom-settings')) return;
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
  else if (action === 'theme' && ['system', ...Object.keys(themeNames)].includes(value)) { $('#theme').value = value; applyTheme(); }
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
    item.tabIndex = 0;
    item.setAttribute('aria-haspopup', 'menu');
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
$('#tab-bar').addEventListener('dblclick', event => {
  if (event.target !== event.currentTarget || event.button !== 0 || fileBusy) return;
  event.preventDefault();
  rememberWorkspaceView();
  perform(() => window.mdview.newDocument());
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
  const result = await window.mdview.closeTab({ id, source: payload().source });
  if (!result.ok && !result.canceled) { $('#notice').textContent = result.message; $('#notice').hidden = false; }
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
  if (result.ok && result.empty) {
    ++viewGeneration; // Invalidate restoration callbacks belonging to the removed tab.
    restoringView = false;
    richEditor?.destroy(); richEditor = null;
    currentDocument = displayedDocument = currentPath = null;
    editing = false;
    observer?.disconnect(); observer = null;
    outlineRoot = outlineSignature = undefined;
    outlineTargets.clear();
    if (codeDialog.open) codeDialog.close();
    for (const selector of ['#content', '#editor-content', '#outline', '#file-name', '#file-path', '#document-status']) $(selector).replaceChildren();
    $('#file-name').title = $('#file-path').title = '';
    renderDocumentTimes();
    $('#heading-count').textContent = '0';
    $('#notice').textContent = t('没有打开的文档');
    $('#notice').hidden = false;
    reader.scrollTop = 0;
    setEditingUI();
    return;
  }
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
// Local wall-clock display only; timestamps are owned by main, never by rendering.
function formatDocumentTime(value, seconds = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8640000000000000) return '—';
  const parts = new Intl.DateTimeFormat(uiLanguage, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23', calendar: 'gregory', numberingSystem: 'latn' }).formatToParts(new Date(value));
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}${seconds ? ':' + get('second') : ''}`;
}
function renderDocumentTimes(doc = currentDocument) {
  const element = $('#document-times');
  element.hidden = !doc;
  $('.document-header').title = '';
  if (!doc) { element.textContent = ''; element.title = ''; element.removeAttribute('aria-label'); return; }
  element.textContent = `${t('创建')} ${formatDocumentTime(doc.createdAt)} · ${t('更新')} ${formatDocumentTime(doc.updatedAt)}`;
  const creation = t(doc.path ? '文件创建时间（文件系统）' : '草稿创建时间');
  const update = t(doc.path ? '最后更新（磁盘修改时间；不含未保存编辑）' : '最后更新（草稿内容修改时间）');
  element.title = `${creation}: ${formatDocumentTime(doc.createdAt, true)}
${update}: ${formatDocumentTime(doc.updatedAt, true)}
${t('本地时间；— 表示未知')}`;
  element.setAttribute('aria-label', element.title);
  $('.document-header').title = element.title;
}
window.mdview.onDocumentTimes(value => {
  if (value.id !== currentDocument?.id || currentDocument.path) return;
  Object.assign(currentDocument, { createdAt: value.createdAt, updatedAt: value.updatedAt });
  if (displayedDocument?.id === value.id) Object.assign(displayedDocument, { createdAt: value.createdAt, updatedAt: value.updatedAt });
  renderDocumentTimes();
});
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
  renderDocumentTimes(doc);
  updateDocumentStatus(doc);
  $('#heading-count').textContent = doc.headings.length;
  $('#notice').textContent = doc.warnings.join(' ');
  $('#notice').hidden = !doc.warnings.length;
  refreshOutline($('#content'), doc.headings);
  reader.scrollTop = scrollByPath.get(doc.path) || 0;
  document.dispatchEvent(new Event('document-search-update'));
}

let outlineRoot;
let outlineSignature;
let outlineTargets = new Map();
function refreshOutline(root, headings) {
  const elements = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  if (!headings) {
    const ids = new Set();
    headings = elements.map(element => {
      const title = element.textContent || '未命名章节';
      const base = title.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'section';
      let id = base;
      for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
      ids.add(id);
      return { id, title, level: Number(element.tagName.slice(1)) };
    });
  }
  // Bind by occurrence, never by text: duplicate headings are distinct targets.
  const nextTargets = new Map(headings.map((heading, index) => [heading.id, elements[index]]));
  const signature = JSON.stringify(headings);
  if (outlineRoot === root && outlineSignature === signature &&
      [...nextTargets].every(([id, element]) => outlineTargets.get(id) === element)) return;
  outlineRoot = root;
  outlineSignature = signature;
  outlineTargets = nextTargets;
  $('#heading-count').textContent = headings.length;
  if (displayedDocument) {
    displayedDocument = { ...displayedDocument, headings };
    updateDocumentStatus(displayedDocument);
  }
  const outline = $('#outline');
  const scrollTop = outline.scrollTop;
  outline.replaceChildren();
  const baseLevel = Math.min(6, ...headings.map(heading => heading.level));
  for (const heading of headings) {
    const link = document.createElement('a');
    link.href = `#${encodeURIComponent(heading.id)}`;
    link.textContent = heading.title;
    link.title = heading.title;
    link.dataset.target = heading.id;
    link.style.paddingLeft = `${16 + (heading.level - baseLevel) * 14}px`;
    outline.append(link);
  }
  if (!headings.length) outline.textContent = t('这份文档没有标题');
  outline.scrollTop = scrollTop;
  observer?.disconnect();
  observer = new IntersectionObserver(entries => {
    const visible = entries.find(entry => entry.isIntersecting);
    if (!visible) return;
    for (const link of outline.querySelectorAll('a')) {
      const active = outlineTargets.get(link.dataset.target) === visible.target;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
    }
  }, { root: reader, rootMargin: '0px 0px -65% 0px' });
  for (const heading of elements) observer.observe(heading);
}
document.addEventListener('click', event => {
  const wrap = event.target.closest('.wrap-code');
  if (wrap) {
    const wrapped = wrap.closest('.code-block').classList.toggle('code-wrapped');
    wrap.setAttribute('aria-pressed', String(wrapped));
    wrap.textContent = wrapped ? '不换行 / No wrap' : '换行 / Wrap';
    wrap.title = wrapped ? '不换行 / Keep long lines' : '自动换行 / Wrap long lines';
    return;
  }
  const collapse = event.target.closest('.collapse-code');
  if (collapse) {
    const block = collapse.closest('.code-block');
    const folded = block.classList.toggle('code-collapsed');
    collapse.setAttribute('aria-expanded', String(!folded));
    collapse.textContent = folded ? '展开 / Unfold' : '折叠 / Fold';
    collapse.title = folded ? '展开 / Expand code' : '折叠 / Collapse code';
    // Do not leave keyboard input in an invisible editable code body.
    if (folded) collapse.focus({ preventScroll: true });
    return;
  }
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
      const target = outlineTargets.get(id) || (!editing && [...$('#content').querySelectorAll('[id]')].find(element => element.id === id));
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
  // Internal editor/text drags carry no OS files. Keep the navigation guard,
  // but do not turn a successful image move into a file-type error toast.
  if (!files.length) return;
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
  if (currentDocument) refreshOutline(editing ? $('#editor-content') : $('#content'), editing ? undefined : displayedDocument?.headings);
  rememberWorkspaceView();
  document.dispatchEvent(new Event('document-search-update'));
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
  $('#block-type').dispatchEvent(new Event('paragraph-style-sync'));
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
function changed() { window.mdview.draft(payload()); setEditingUI(); window.mdviewSearch?.refresh(); }
// Reader and editor have different widths and DOM wrappers. Match semantic
// blocks, including duplicate occurrences, rather than carrying raw scrollTop.
function modeViewBlocks(root) {
  const occurrences = new Map();
  return [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,pre,li,td,th')].filter(element => {
    if (element.closest('.code-toolbar')) return false;
    if (element.tagName === 'P' && element.closest('td,th')) return false;
    if (element.tagName === 'LI' && element.querySelector('p')) return false;
    return element.getBoundingClientRect().height > 0;
  }).map(element => {
    // A tight reader list has text directly in LI; the editor wraps it in P.
    const clone = element.cloneNode(true);
    clone.querySelectorAll('ul,ol,.code-toolbar,.image-size-controls,.image-resize-handles,.ProseMirror-trailingBreak').forEach(node => node.remove());
    const kind = /^(H[1-6]|PRE)$/.test(element.tagName) ? element.tagName : 'text';
    const images = [...clone.querySelectorAll('img:not(.ProseMirror-separator)')].map(image => image.getAttribute('alt') || '').join('|');
    const key = `${kind}:${clone.textContent.replace(/\s+/g, ' ').trim()}:${images}`;
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    return { element, key, occurrence };
  });
}
function captureModeView() {
  const top = reader.getBoundingClientRect().top;
  const blocks = modeViewBlocks(editing ? $('#editor-content') : $('#content'));
  const block = blocks.find(({ element }) => element.getBoundingClientRect().bottom > top + 24);
  if (!block) return { scrollTop: reader.scrollTop };
  const rect = block.element.getBoundingClientRect();
  return { key: block.key, occurrence: block.occurrence, offset: rect.top - top,
    fraction: Math.max(0, (top - rect.top) / rect.height), scrollTop: reader.scrollTop };
}
function restoreModeView(view) {
  const block = modeViewBlocks(editing ? $('#editor-content') : $('#content'))
    .find(block => block.key === view.key && block.occurrence === view.occurrence);
  let top = view.scrollTop;
  if (block) {
    const rect = block.element.getBoundingClientRect();
    const offset = view.offset < 0 ? -view.fraction * rect.height : view.offset;
    top = reader.scrollTop + rect.top - reader.getBoundingClientRect().top - offset;
  }
  reader.scrollTo({ top, behavior: 'instant' });
}
async function toggleEditing() {
  if (!currentDocument || fileBusy) return;
  if (codeDialog.open) codeDialog.close();
  const enteringNewEditor = !richEditor;
  if (!richEditor) createRichEditor();
  let doc;
  if (editing) {
    const generation = viewGeneration, editor = richEditor, snapshot = payload();
    doc = await window.mdview.preview(snapshot);
    // A tab switch/close or newer keystroke while IPC is in flight owns the view.
    if (generation !== viewGeneration || editor !== richEditor || !editing || snapshot.source !== richEditor.source()) return;
  }
  // Capture after preview IPC: scrolling while it was pending is intentional.
  const view = captureModeView();
  // Mode changes supersede only pending tab/preview restoration.
  ++viewGeneration;
  restoringView = true;
  try {
    if (doc) renderDocument({ ok: true, document: doc });
    editing = !editing; setEditingUI();
    restoreModeView(view);
    if (editing) {
      if (enteringNewEditor) {
        // A newly mounted editor has only a synthetic start selection. Put its
        // first caret in the visible content, without a scrolling transaction.
        const bounds = reader.getBoundingClientRect();
        const content = richEditor.editor.view.dom.getBoundingClientRect();
        const position = richEditor.editor.view.posAtCoords({ left: content.left + 8,
          top: bounds.top + Math.min(reader.clientHeight - 20, Math.max(32, view.offset || 0) + 8) });
        if (position) richEditor.editor.commands.setTextSelection(position.pos);
      }
      // ProseMirror's view.focus uses preventScroll; Tiptap commands.focus
      // schedules an unwanted scroll-to-selection on the next frame.
      richEditor.editor.view.focus();
    }
  } finally {
    restoringView = false;
    rememberWorkspaceView();
  }

}
async function saveDocument(asNew = false) {
  if (!currentDocument || fileBusy) return;
  const result = await window.mdview.save({ ...payload(), asNew });
  if (!result.ok && !result.canceled) { $('#notice').textContent = result.message; $('#notice').hidden = false; }
}

window.mdview.onToggleEdit(() => perform(toggleEditing));
// The editor's Mod-E inline-code keymap otherwise consumes the application's
// mode shortcut before Electron's menu accelerator gets a chance to run.
$('#editor-content').addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'e') return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) perform(toggleEditing);
}, { capture: true });
window.mdview.onSaveRequest(asNew => perform(() => saveDocument(asNew)));
window.mdview.onEditError(message => { $('#notice').textContent = message; $('#notice').hidden = false; });
window.mdview.onBusy(value => {
  fileBusy = value;
  richEditor?.editor.setEditable(!value, false);

  syncEditorTools();
});
window.mdviewPrepareClose = () => {
  fileBusy = true;
  richEditor?.editor.setEditable(false, false);
  return currentDocument ? {
    ...payload(),
    viewState: restoringView && currentDocument.viewState
      ? currentDocument.viewState : { editing, scrollTop: reader.scrollTop }
  } : null;
};
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
  renderDocumentTimes();
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
  if (!richEditor || fileBusy || !editing) return;
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
