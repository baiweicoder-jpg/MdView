const fs = require('node:fs/promises');
const path = require('node:path');
const { app, dialog, ipcMain } = require('electron');

module.exports = async function settings(win, trusted) {
  const file = path.join(app.getPath('userData'), 'settings.json');
  let saveDirectory = '';
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    if (typeof saved.saveDirectory === 'string' && path.isAbsolute(saved.saveDirectory)) saveDirectory = saved.saveDirectory;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('无法读取保存位置设置，使用系统文档目录。');
  }
  const get = () => ({ saveDirectory: saveDirectory || app.getPath('documents') });
  async function update(directory) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ saveDirectory: directory }, null, 2), 'utf8');
    await fs.rename(`${file}.tmp`, file);
    saveDirectory = directory;
    return get();
  }
  let busy = false;
  async function change(action) {
    if (busy) throw Error('设置正在处理中，请稍候。');
    busy = true;
    try { return await action(); } finally { busy = false; }
  }
  ipcMain.handle('get-settings', event => { trusted(event); return get(); });
  ipcMain.handle('choose-save-directory', event => {
    trusted(event);
    return change(async () => {
      const result = await dialog.showOpenDialog(win, { title: '选择默认保存文件夹', defaultPath: get().saveDirectory, properties: ['openDirectory', 'createDirectory'] });
      if (result.canceled) return get();
      const directory = result.filePaths[0];
      if (!(await fs.stat(directory)).isDirectory()) throw Error('请选择文件夹。');
      return update(directory);
    });
  });
  ipcMain.handle('reset-save-directory', event => { trusted(event); return change(() => update('')); });
  return get;
};
