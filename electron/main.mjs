// Shell desktop: inicia o servidor local, abre a janela do operador e posiciona a tela do público no segundo monitor.
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let server = null;
let operator = null;

// pasta de dados alternativa (usada em testes automatizados)
if (process.env.KP_USER_DATA) app.setPath('userData', process.env.KP_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

/** F11 alterna a tela cheia; Esc sai dela. */
function fullscreenKeys(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen() && win !== operator) {
      win.setFullScreen(false);
    }
  });
}

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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      autoplayPolicy: 'no-user-gesture-required',
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  };
  if (external) {
    // Segundo monitor: tela cheia nele
    return { ...base, x: external.bounds.x, y: external.bounds.y, width: external.bounds.width, height: external.bounds.height, fullscreen: true };
  }
  // Um monitor só: abre em janela (F11, tecla F ou o botão colocam em tela cheia)
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
  operator.webContents.on('did-create-window', (win) => fullscreenKeys(win));
  fullscreenKeys(operator);
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

ipcMain.handle('kp:toggle-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle('kp:set-fullscreen', (event, on) => {
  BrowserWindow.fromWebContents(event.sender)?.setFullScreen(!!on);
});

app.on('second-instance', () => {
  if (operator) {
    if (operator.isMinimized()) operator.restore();
    operator.focus();
  }
});

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(null); // sem barra de menus: a janela fica limpa, inclusive em tela cheia
    server = await startServer({ dataDir: path.join(app.getPath('userData'), 'data'), desktop: true });
    // Permissões: microfone só para a própria interface; tela cheia para o app e para o player do YouTube
    const own = (url) => typeof url === 'string' && url.startsWith(server.url);
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (permission === 'fullscreen') return callback(true);
      if (permission === 'media') return callback(own(details.requestingUrl) && !(details.mediaTypes || []).includes('video'));
      callback(false);
    });
    session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => {
      if (permission === 'fullscreen') return true;
      if (permission === 'media') return own(origin + '/');
      return false;
    });
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
