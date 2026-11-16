// Shell desktop: inicia o servidor local, abre a janela do operador e posiciona a tela do público no segundo monitor.
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let server = null;
let operator = null;

if (!app.requestSingleInstanceLock()) app.quit();

const MEDIA_FILTER = {
  name: 'Karaokê',
  extensions: ['mp3', 'mp4', 'm4v', 'm4a', 'webm', 'ogg', 'wav', 'mkv', 'avi', 'mov', 'zip', 'cdg'],
};

function audienceWindowOptions() {
  const primary = screen.getPrimaryDisplay();
  const external = screen.getAllDisplays().find((d) => d.id !== primary.id);
  const base = {
    title: 'Karaoke Pro — Tela do público',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', contextIsolation: true, sandbox: true, backgroundThrottling: false },
  };
  if (external) {
    // Segundo monitor: tela cheia nele
    return { ...base, x: external.bounds.x, y: external.bounds.y, width: external.bounds.width, height: external.bounds.height, fullscreen: true };
  }
  return { ...base, width: 1280, height: 720 };
}

function createOperatorWindow() {
  operator = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 1100,
    minHeight: 640,
    title: 'Karaoke Pro',
    backgroundColor: '#0b0c10',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false, // mantém a sincronização mesmo com a janela minimizada
    },
  });
  operator.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(server.url)) return { action: 'allow', overrideBrowserWindowOptions: audienceWindowOptions() };
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // A interface nunca navega para fora do servidor local
  operator.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(server.url)) e.preventDefault();
  });
  operator.on('closed', () => {
    operator = null;
    for (const w of BrowserWindow.getAllWindows()) w.close();
  });
  operator.loadURL(server.url);
}

ipcMain.handle('kp:pick-folder', async () => {
  const r = await dialog.showOpenDialog(operator, { title: 'Importar pasta de músicas', properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('kp:pick-files', async () => {
  const r = await dialog.showOpenDialog(operator, { title: 'Importar arquivos', properties: ['openFile', 'multiSelections'], filters: [MEDIA_FILTER] });
  return r.canceled ? [] : r.filePaths;
});

app.on('second-instance', () => {
  if (operator) {
    if (operator.isMinimized()) operator.restore();
    operator.focus();
  }
});

app.whenReady().then(async () => {
  try {
    server = await startServer({ dataDir: path.join(app.getPath('userData'), 'data'), desktop: true });
    createOperatorWindow();
  } catch (e) {
    dialog.showErrorBox('Karaoke Pro', `Não foi possível iniciar: ${e.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  server?.close();
  app.quit();
});
