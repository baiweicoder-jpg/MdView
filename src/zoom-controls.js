// Scoped chrome zoom. Load after sidebar.js and menu-bar.js.
(() => {
  const sidebar = document.querySelector('#sidebar');
  const menu = document.querySelector('#menu-bar');
  if (!sidebar || !menu || document.querySelector('#zoom-settings')) return;
  const key = 'mdview-sidebar-font-size';
  let size = 12;
  try { const saved = Number(localStorage.getItem(key)); if (Number.isInteger(saved) && saved >= 10 && saved <= 22) size = saved; } catch {}
  let zoom = 1, desired = 1, saving = false, ready = false;
  const section = document.createElement('fieldset');
  section.id = 'zoom-settings';
  const legend = document.createElement('legend');
  const hint = document.createElement('p');
  const globalReset = document.createElement('button');
  const sidebarReset = document.createElement('button');
  const error = document.createElement('p');
  error.setAttribute('role', 'alert'); error.hidden = true;
  globalReset.type = sidebarReset.type = 'button';
  globalReset.id = 'ui-zoom-reset'; sidebarReset.id = 'sidebar-font-reset';
  section.append(legend, hint, globalReset, sidebarReset, error);
  document.querySelector('#settings-dialog').append(section);
  const text = (zh, en) => document.documentElement.lang === 'en' ? en : zh;
  function labels() {
    legend.textContent = text('界面与侧栏缩放', 'Interface and sidebar zoom');
    hint.textContent = text('Ctrl + 滚轮：菜单栏缩放整个界面（75–150%）；侧栏仅调整目录和文件字号。系统标题栏不支持此手势。', 'Ctrl + wheel: menu bar scales the interface (75–150%); sidebar changes outline and file text only. The system title bar does not support this gesture.');
    menu.title = text('Ctrl + 滚轮缩放整个界面', 'Ctrl + wheel to scale the interface');
    sidebar.title = text('Ctrl + 滚轮调整侧栏字号', 'Ctrl + wheel to resize sidebar text');
    globalReset.textContent = text(`界面 ${Math.round(desired * 100)}% · 重置为 100%`, `Interface ${Math.round(desired * 100)}% · Reset to 100%`);
    sidebarReset.textContent = text(`侧栏 ${size}px · 重置为 12px`, `Sidebar ${size}px · Reset to 12px`);
    globalReset.disabled = !ready;
  }
  function applySize() {
    sidebar.style.setProperty('--sidebar-font-size', `${size}px`);
    try { localStorage.setItem(key, String(size)); } catch {}
    labels();
  }
  async function saveZoom() {
    if (saving || !ready) return;
    saving = true; error.hidden = true;
    try {
      // Coalesce wheel bursts; never race settings writes or lose the last step.
      while (Math.abs(zoom - desired) > 0.001) {
        zoom = await window.mdview.setUIZoom(desired);
      }
    } catch {
      desired = zoom;
      error.textContent = text('无法保存界面缩放，请重试。', 'Could not save interface zoom. Please retry.');
      error.hidden = false;
    } finally { saving = false; labels(); }
  }
  function changeZoom(steps) {
    if (!ready) return;
    desired = steps === 0 ? 1 : Math.max(0.75, Math.min(1.5, Math.round((desired + steps * 0.1) * 100) / 100));
    labels(); void saveZoom();
  }
  function wheelScope(node, apply) {
    let accumulated = 0, previous = 0;
    node.addEventListener('wheel', event => {
      if (!event.ctrlKey || document.querySelector('dialog[open]')) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.deltaY) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1);
      if (event.timeStamp - previous > 300 || Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      previous = event.timeStamp;
      accumulated += delta;
      const steps = Math.trunc(accumulated / 100);
      if (steps) { accumulated -= steps * 100; apply(-steps); }
    }, { passive: false, capture: true });
  }
  wheelScope(sidebar, steps => { size = Math.max(10, Math.min(22, size + steps)); applySize(); });
  wheelScope(menu, changeZoom);
  section.addEventListener('wheel', event => { if (event.ctrlKey) event.preventDefault(); }, { passive: false });
  globalReset.addEventListener('click', () => changeZoom(0));
  sidebarReset.addEventListener('click', () => { size = 12; applySize(); });
  window.mdview.onMenuAction((action, value) => { if (action === 'ui-zoom') changeZoom(value); });
  new MutationObserver(labels).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  applySize();
  window.mdview.getSettings().then(settings => {
    zoom = desired = settings.uiZoom; ready = true; labels(); section.dataset.ready = 'true';
  }).catch(() => { error.textContent = text('无法读取界面缩放设置。', 'Could not load interface zoom settings.'); error.hidden = false; });
})();
