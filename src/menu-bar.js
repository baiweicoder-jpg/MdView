// One compact application-menu row; submenu contents remain native Electron menus.
(() => {
  if (document.getElementById('menu-bar')) return;
  const api = window.mdview;
  const definitions = {
    edit: ['编辑模式', 'Edit mode', 'edit', 'Ctrl+E'],
    save: ['保存', 'Save', 'save', 'Ctrl+S'],
    open: ['打开 Markdown…', 'Open Markdown…', 'folder', 'Ctrl+O'],
    new: ['新建空白文档', 'New blank document', 'file-plus', 'Ctrl+N'],
    outline: ['切换目录', 'Toggle outline', 'outline', 'Ctrl+Shift+B'],
    settings: ['偏好设置…', 'Preferences…', 'settings', 'Ctrl+,'],
    reload: ['重新读取', 'Reload document', 'refresh', 'Ctrl+R']
  };
  let language = document.documentElement.lang;
  let selected = ['edit', 'save', 'open', 'new'];
  let state = {};
  let busy = false;
  let previousFocus;
  let popupOpen = false;
  const label = action => definitions[action][language === 'en' ? 1 : 0];
  const text = (zh, en) => language === 'en' ? en : zh;
  const row = document.createElement('div');
  row.id = 'menu-bar';
  const menus = document.createElement('nav');
  menus.className = 'menu-bar-menus';
  menus.setAttribute('role', 'menubar');
  const actions = document.createElement('div');
  actions.id = 'quick-actions';
  actions.setAttribute('role', 'group');
  row.append(menus, actions);
  document.body.prepend(row);
  const section = document.createElement('fieldset');
  section.id = 'quick-action-settings';
  const legend = document.createElement('legend');
  section.append(legend);
  const options = document.createElement('div');
  options.className = 'quick-action-options';
  section.append(options);
  const error = document.createElement('p');
  error.className = 'quick-action-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  section.append(error);
  document.getElementById('settings-dialog').append(section);

  function reportError() {
    error.textContent = text('无法保存设置，请检查文件夹权限后重试。', 'Could not save settings. Check folder permissions and try again.');
    error.hidden = false;
  }
  function syncState() {
    for (const button of actions.querySelectorAll('button')) {
      button.disabled = busy && ['edit', 'save', 'open', 'new', 'reload'].includes(button.dataset.quickAction);
      if (button.dataset.quickAction === 'edit') button.setAttribute('aria-pressed', String(!!state.editing));
    }
  }
  function renderActions() {
    const focused = actions.contains(document.activeElement) ? document.activeElement.dataset.quickAction : null;
    actions.replaceChildren();
    for (const action of selected) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.quickAction = action;
      button.title = `${label(action)} (${definitions[action][3]})`;
      button.setAttribute('aria-label', label(action));
      const icon = document.createElement('span');
      icon.dataset.icon = definitions[action][2];
      button.append(icon);
      // Keep the editor's selection while invoking editing/save actions.
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => api.quickAction(action).catch(reportError));
      actions.append(button);
    }
    window.mdviewIcons.render(actions);
    syncState();
    if (focused) actions.querySelector(`[data-quick-action="${focused}"]`)?.focus();
    for (const input of options.querySelectorAll('input')) input.checked = selected.includes(input.value);
  }
  async function showMenu(button) {
    if (popupOpen) return;
    popupOpen = true;
    button.setAttribute('aria-expanded', 'true');
    const rect = button.getBoundingClientRect();
    try { await api.popupMenu(Number(button.dataset.menuIndex), { x: rect.left, y: rect.bottom }); }
    catch (error) { console.error(error); }
    finally { popupOpen = false; button.setAttribute('aria-expanded', 'false'); button.focus(); }
  }
  async function renderMenus() {
    const data = await api.getMenuBar();
    state = data.state;
    menus.replaceChildren();
    for (const item of data.menus) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.menuIndex = item.index;
      button.textContent = item.label;
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
      button.tabIndex = item.index === 0 ? 0 : -1;
      button.title = `${item.label} (Alt+${['F', 'E', 'V', 'S'][item.index]})`;
      button.addEventListener('click', () => showMenu(button));
      button.addEventListener('focus', () => { for (const sibling of menus.children) sibling.tabIndex = sibling === button ? 0 : -1; });
      menus.append(button);
    }
    syncState();
  }
  menus.addEventListener('keydown', event => {
    const buttons = [...menus.children];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    } else if (event.key === 'ArrowDown') { event.preventDefault(); showMenu(buttons[index]); }
    else if (event.key === 'Escape') { event.preventDefault(); previousFocus?.focus(); }
  });
  api.onActivateMenuBar(index => {
    if (document.querySelector('dialog[open]')) return;
    if (!row.contains(document.activeElement)) previousFocus = document.activeElement;
    const button = menus.children[index ?? 0];
    if (button) { button.focus(); if (Number.isInteger(index)) showMenu(button); }
  });
  function translateChrome() {
    menus.setAttribute('aria-label', text('应用菜单', 'Application menu'));
    actions.setAttribute('aria-label', text('快捷操作', 'Quick actions'));
    legend.textContent = text('菜单栏快捷操作', 'Menu bar quick actions');
    for (const span of options.querySelectorAll('[data-action-label]')) span.textContent = label(span.dataset.actionLabel);
    renderActions();
  }
  for (const action of Object.keys(definitions)) {
    const option = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = action;
    const span = document.createElement('span');
    span.dataset.actionLabel = action;
    option.append(input, span);
    options.append(option);
    input.addEventListener('change', async () => {
      section.disabled = true;
      error.hidden = true;
      const next = input.checked ? [...selected, action] : selected.filter(item => item !== action);
      try { selected = (await api.setQuickActions(next)).quickActions; }
      catch { reportError(); }
      finally { section.disabled = false; renderActions(); }
    });
  }
  api.onMenuStateChanged(value => { state = value; syncState(); });
  api.onBusy(value => { busy = value; syncState(); });
  api.onQuickActionsChanged(value => { selected = value; renderActions(); });
  api.onLanguageChanged(value => { language = value; translateChrome(); renderMenus().catch(console.error); });
  Promise.all([api.getSettings(), renderMenus()]).then(([settings]) => {
    language = settings.language;
    selected = settings.quickActions;
    translateChrome();
    row.dataset.ready = 'true';
  }).catch(console.error);
})();
