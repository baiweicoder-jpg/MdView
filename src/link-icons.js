// Optional, local renderer preference. CSSOM rules decorate links without touching
// ProseMirror DOM/marks or serialized Markdown. No renderer network capability.
(() => {
  const dialog = document.getElementById('settings-dialog');
  if (!dialog || document.getElementById('link-icon-settings')) return;
  const sheet = [...document.styleSheets].find(s => s.href && new URL(s.href).pathname.endsWith('/link-icons.css'));
  if (!sheet) return; // Fail closed if the external CSP-approved stylesheet is absent.
  const baseRules = sheet.cssRules.length;
  const roots = [document.getElementById('content'), document.getElementById('editor-content')].filter(Boolean);
  const cache = new Map();
  const KEY = 'mdview-link-icons', LIMIT = 128;
  let enabled = false, generation = 0, scheduled = false;
  try { enabled = localStorage.getItem(KEY) === 'true'; } catch { /* Unavailable storage defaults off. */ }
  const section = document.createElement('section'); section.id = 'link-icon-settings';
  const label = document.createElement('label'); label.className = 'view-row';
  const caption = document.createElement('span');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = 'link-icons-enabled';
  checkbox.checked = enabled; checkbox.setAttribute('aria-describedby', 'link-icons-note');
  label.append(caption, checkbox);
  const note = document.createElement('p'); note.id = 'link-icons-note'; note.className = 'settings-note';
  section.append(label, note); dialog.append(section);
  function translate() {
    const english = document.documentElement.lang === 'en';
    caption.textContent = english ? 'Website icons beside links' : '在链接旁显示网站图标';
    note.textContent = english
      ? 'Off by default. When enabled, contacts linked sites directly for /favicon.ico (revealing your IP and the site, never the document or link path). No third-party icon service. Unsupported or unavailable icons remain plain text links.'
      : '默认关闭。开启后直接连接链接网站获取 /favicon.ico（网站可见您的 IP，但不会收到文档或链接路径），不使用第三方图标服务。不支持或无法获取图标时保留文字链接。';
  }
  function targetFor(href) {
    if (typeof href !== 'string' || href.length > 8192 || !/^https?:\/\//i.test(href)) return null;
    try {
      const url = new URL(href);
      if (url.username || url.password || url.port) return null;
      return { protocol: url.protocol, hostname: url.hostname };
    } catch { return null; }
  }
  function validData(data) {
    return typeof data === 'string' && data.length <= 22000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data);
  }
  function clearRules() { while (sheet.cssRules.length > baseRules) sheet.deleteRule(sheet.cssRules.length - 1); }
  function schedule() {
    if (!enabled || scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; if (enabled) scan(); }, 30);
  }
  function scan() {
    if (!enabled) return;
    clearRules();
    const hrefs = new Map();
    for (const root of roots) {
      for (const link of root.querySelectorAll('a[href]')) {
        if (hrefs.size >= LIMIT) break;
        const href = link.getAttribute('href'), target = targetFor(href);
        if (target) hrefs.set(href, target);
      }
    }
    for (const [href, target] of hrefs) {
      const key = target.protocol + '//' + target.hostname;
      let entry = cache.get(key);
      if (!entry) {
        // Keep the per-page network/privacy budget bounded even for hostile documents.
        if (cache.size >= LIMIT) continue;
        entry = { data: null }; cache.set(key, entry);
        const token = generation;
        Promise.resolve().then(() => {
          if (enabled && generation === token) return window.mdview?.getLinkIcon?.(target);
        }).then(data => {
          if (!enabled || generation !== token) return;
          entry.data = validData(data) ? data : null;
          if (entry.data) schedule();
        }).catch(() => {});
      }
      if (entry.data) {
        const selectors = roots.map(root => `#${root.id} a[href="${CSS.escape(href)}"]`).join(',');
        sheet.insertRule(`${selectors} { background-image: url("${entry.data}"); background-repeat: no-repeat; background-position: left center; background-size: 1em 1em; padding-inline-start: 1.3em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }`, sheet.cssRules.length);
      }
    }
  }
  checkbox.addEventListener('change', () => {
    enabled = checkbox.checked; generation++;
    try { localStorage.setItem(KEY, String(enabled)); } catch { /* Session-only is safe. */ }
    clearRules(); cache.clear(); if (enabled) schedule();
  });
  // CSSOM writes produce no observed mutations. Never observe style/class or write document nodes.
  const observer = new MutationObserver(schedule);
  for (const root of roots) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
  new MutationObserver(translate).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  window.mdview?.onLanguageChanged?.(() => queueMicrotask(translate));
  translate(); if (enabled) schedule();
})();
