const $ = selector => document.querySelector(selector);
const reader = $('#reader');
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
  if (event.deltaY) changeFont(-Math.sign(event.deltaY));
}, { passive: false });
$('#open').addEventListener('click', () => perform(() => window.mdview.open()));
$('#reload').addEventListener('click', () => perform(() => window.mdview.reload()));
function toggleOutline() {
  const hidden = document.body.classList.toggle('outline-hidden');
  $('#toggle-outline').setAttribute('aria-expanded', String(!hidden));
}
$('#toggle-outline').addEventListener('click', toggleOutline);
window.mdview.onToggleOutline(toggleOutline);
let observer;
let currentPath;
window.mdview.onDocument(result => {
  if (!result.ok) {
    $('#notice').textContent = result.message;
    $('#notice').hidden = false;
    return;
  }
  const doc = result.document;
  const previousScroll = currentPath === doc.path ? reader.scrollTop : 0;
  currentPath = doc.path;
  $('#content').innerHTML = doc.html;
  $('#file-name').textContent = doc.name;
  $('#file-path').textContent = doc.path;
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
});
document.addEventListener('click', event => {
  const zoom = event.target.closest('button[data-code-zoom]');
  if (zoom) {
    const block = zoom.closest('.code-block');
    const direction = Number(zoom.dataset.codeZoom);
    const percent = direction === 0 ? 100 : Math.max(70, Math.min(200, Number(block.dataset.codeZoom || 100) + direction * 10));
    block.dataset.codeZoom = percent;
    block.style.setProperty('--code-scale', percent / 100);
    block.querySelector('.code-zoom-reset').textContent = `${percent}%`;
    block.querySelector('[data-code-zoom="-1"]').disabled = percent === 70;
    block.querySelector('[data-code-zoom="1"]').disabled = percent === 200;
    return;
  }
  const copy = event.target.closest('.copy-code');
  if (copy) {
    perform(async () => { await window.mdview.copy(copy.closest('.code-block').querySelector('code').textContent); toast('代码已复制'); });
    return;
  }
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  const href = link.getAttribute('href') || '';
  if (href.startsWith('#')) {
    try {
      const id = decodeURIComponent(href.slice(1));
      const target = [...$('#content').querySelectorAll('[id]')].find(element => element.id === id);
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
