// Ponte mínima entre a interface e o sistema: diálogos nativos de seleção e tela cheia da janela.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kpDesktop', {
  pickFolder: () => ipcRenderer.invoke('kp:pick-folder'),
  pickFiles: () => ipcRenderer.invoke('kp:pick-files'),
  toggleFullscreen: () => ipcRenderer.invoke('kp:toggle-fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('kp:set-fullscreen', !!on),
});
