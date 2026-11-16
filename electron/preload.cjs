// Ponte mínima entre a interface e o sistema: apenas os diálogos nativos de seleção.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kpDesktop', {
  pickFolder: () => ipcRenderer.invoke('kp:pick-folder'),
  pickFiles: () => ipcRenderer.invoke('kp:pick-files'),
});
