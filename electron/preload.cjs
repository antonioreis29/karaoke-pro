// Ponte mínima entre a interface e o sistema: diálogos nativos de seleção e tela cheia da janela.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kpDesktop', {
  pickFolder: () => ipcRenderer.invoke('kp:pick-folder'),
  pickFiles: () => ipcRenderer.invoke('kp:pick-files'),
  toggleFullscreen: () => ipcRenderer.invoke('kp:toggle-fullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('kp:set-fullscreen', !!on),
  // conta do YouTube na sessão do app (login pela página oficial do Google)
  youtubeStatus: () => ipcRenderer.invoke('kp:youtube-status'),
  youtubeLogin: () => ipcRenderer.invoke('kp:youtube-login'),
  youtubeLogout: () => ipcRenderer.invoke('kp:youtube-logout'),
});
