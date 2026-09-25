const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('mdview', {
  open: () => ipcRenderer.invoke('open'),
  drop: file => ipcRenderer.invoke('drop', webUtils.getPathForFile(file)),
  reload: () => ipcRenderer.invoke('reload-document'),
  external: href => ipcRenderer.invoke('external', href),
  copy: text => ipcRenderer.invoke('copy', text),
  onDocument: callback => ipcRenderer.on('document', (_event, result) => callback(result)),
  onToggleOutline: callback => ipcRenderer.on('toggle-outline', () => callback())
});
