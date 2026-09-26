const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');
const { languages, translate } = require('./i18n.cjs');

module.exports = async function settings(win, trusted, onLanguageChanged = () => {}) {
  const file = path.join(app.getPath('userData'), 'settings.json');
  let saveDirectory = '';
  let language = 'zh-CN';
  const allowedActions = ['edit', 'save', 'open', 'new', 'outline', 'settings', 'reload'];
  let quickActions = ['edit', 'save', 'open', 'new'];
  const validActions = value => Array.isArray(value) && value.length <= allowedActions.length && value.every(action => allowedActions.includes(action)) && new Set(value).size === value.length;
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (validActions(saved.quickActions)) quickActions = saved.quickActions;
    if (languages.includes(saved.language)) language = saved.language;
    if (typeof saved.saveDirectory === 'string' && path.isAbsolute(saved.saveDirectory)) saveDirectory = saved.saveDirectory;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('无法读取保存位置设置，使用系统文档目录。');
  }
  const get = () => ({ saveDirectory: saveDirectory || app.getPath('documents'), language, quickActions: [...quickActions] });
  async function update(directory, nextLanguage = language, nextActions = quickActions) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ saveDirectory: directory, language: nextLanguage, quickActions: nextActions }, null, 2), 'utf8');
    await fs.rename(`${file}.tmp`, file);
    saveDirectory = directory;
    language = nextLanguage;
    quickActions = [...nextActions];
    return get();
  }
  let busy = false;
  async function change(action) {
    if (busy) throw Error(translate('设置正在处理中，请稍候。', language));
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  ipcMain.handle('set-quick-actions', (event, value) => {
    trusted(event);
    if (!validActions(value)) throw Error('Invalid quick actions');
    return change(async () => {
      const result = await update(saveDirectory, language, value);
      win.webContents.send('quick-actions-changed', result.quickActions);
      return result;
    });
  });
  ipcMain.handle('get-settings', event => { trusted(event); return get(); });
  ipcMain.handle('set-language', (event, value) => {
    trusted(event);
    if (!languages.includes(value)) throw Error('Unsupported UI language');
    return change(async () => {
      const result = await update(saveDirectory, value);
      onLanguageChanged(value);
      win.webContents.send('language-changed', value);
      return result;
    });
  });
  ipcMain.handle('choose-save-directory', event => {
    trusted(event);
    return change(async () => {
      const result = await dialog.showOpenDialog(win, { title: translate('选择默认保存文件夹', language), defaultPath: get().saveDirectory, properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled) return get();
      const directory = result.filePaths[0];
      if (!(await fs.stat(directory)).isDirectory()) throw Error(translate('请选择文件夹。', language));
      return update(directory);
    });
  });
  ipcMain.handle('reset-save-directory', event => { trusted(event); return change(() => update('')); });
  return get;
};
