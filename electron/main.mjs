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
    if (new URL(url).origin === new URL(server.url).origin) return { action: 'allow', overrideBrowserWindowOptions: audienceWindowOptions() };
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  operator.webContents.on('did-create-window', (win) => fullscreenKeys(win));
  fullscreenKeys(operator);
  // A interface nunca navega para fora do servidor local
  operator.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== new URL(server.url).origin) e.preventDefault();
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

// ---------------------------------------------------------------- conta do YouTube no app
// O player oficial às vezes pede "faça login para confirmar que você não é um robô". O operador pode entrar na
// própria conta do YouTube pela página oficial de login do Google; os cookies ficam na sessão do app e o player
// incorporado passa a tocar com a conta. Nada aqui lê, guarda ou envia senhas.
const YOUTUBE_LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=' +
  encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=%2F');
let loginWindow = null;

async function youtubeSignedIn() {
  const cookies = await session.defaultSession.cookies.get({ domain: 'youtube.com' });
  return cookies.some((c) => c.name === 'LOGIN_INFO' || c.name === 'SAPISID' || c.name === '__Secure-3PSID');
}

ipcMain.handle('kp:youtube-status', () => youtubeSignedIn());

ipcMain.handle('kp:youtube-login', (event) => {
  if (loginWindow) {
    loginWindow.focus();
    return new Promise((resolve) => loginWindow.once('closed', () => youtubeSignedIn().then(resolve)));
  }
  return new Promise((resolve) => {
    loginWindow = new BrowserWindow({
      parent: BrowserWindow.fromWebContents(event.sender) ?? undefined,
      width: 520,
      height: 720,
      title: 'Entrar no YouTube',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    // links de ajuda e janelas extras abrem no navegador do Windows
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    loginWindow.webContents.on('will-navigate', (e, url) => {
      if (!/^https:\/\//.test(url)) e.preventDefault();
    });
    // terminou o login (voltou para o YouTube com a sessão aberta): fecha sozinha
    const check = async () => {
      if (!loginWindow) return;
      const onYouTube = /^https:\/\/(www\.)?youtube\.com\//.test(loginWindow.webContents.getURL());
      if (onYouTube && (await youtubeSignedIn())) loginWindow?.close();
    };
    loginWindow.webContents.on('did-navigate', check);
    loginWindow.webContents.on('did-finish-load', check);
    loginWindow.on('closed', () => {
      loginWindow = null;
      youtubeSignedIn().then(resolve);
    });
    loginWindow.loadURL(YOUTUBE_LOGIN_URL);
  });
});

ipcMain.handle('kp:youtube-logout', async () => {
  const all = await session.defaultSession.cookies.get({});
  const mine = all.filter((c) => /(^|\.)(youtube|google)\.com$/.test((c.domain || '').replace(/^\./, '')));
  await Promise.all(
    mine.map((c) => session.defaultSession.cookies.remove(`https://${(c.domain || '').replace(/^\./, '')}${c.path || '/'}`, c.name).catch(() => undefined))
  );
  await session.defaultSession.cookies.flushStore();
  return youtubeSignedIn();
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
    const own = (url) => { try { return new URL(url).origin === new URL(server.url).origin; } catch { return false; } };
    // Algumas versões de WebView omitem o Referer. Identifica o próprio app apenas quando ele faltar.
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/embed/*'] }, (details, callback) => {
      const headers = details.requestHeaders;
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'referer' && headers[k])) headers.Referer = 'https://br.karaokepro.app/';
      callback({ requestHeaders: headers });
    });
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
