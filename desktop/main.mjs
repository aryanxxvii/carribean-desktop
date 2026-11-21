import { app, BrowserWindow, ipcMain, dialog, shell, session, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createService } from '../core/service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'dist', 'index.html');
let window;
let service;
app.setPath('userData', path.join(app.getPath('appData'), 'Carribean'));

function showWindow() {
  window = new BrowserWindow({
    title: 'Caribbean', backgroundColor: '#0c0c0c', width: 1500, height: 980, icon: path.join(here, '..', 'dist', 'icon.png'),
    minWidth: 720, minHeight: 640, show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#0c0c0c', symbolColor: '#f1f1f1', height: 44 },
    webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  void window.loadFile(entry);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.carribean.library');
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    service = createService({
      open: async (movie) => {
        const error = await shell.openPath(movie);
        if (error) throw new Error(error);
      },
      pickFolder: async (kind) => {
        const selected = await dialog.showOpenDialog(window, {
          title: kind === 'legacy' ? 'Select the original Caribbean library' : 'Select your movie folder',
          properties: ['openDirectory']
        });
        return selected.filePaths[0] || '';
      }
    });
    const initial = service.start();
    ipcMain.handle('carribean:library', async (event, action, payload) => {
      if (event.senderFrame?.url !== pathToFileURL(entry).href) return { error: 'Invalid Caribbean window.' };
      try {
        await initial;
        return { value: await service.action(action, payload) };
      } catch (error) {
        return { error: error.message };
      }
    });
    showWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => service?.stop());
}
