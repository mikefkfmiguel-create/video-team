const { app, BrowserWindow, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const ORIGIN = 'http://7eventos.avk.pt';
const START = ORIGIN + '/7Eventos/EscalasTecnicos/GetPeriodoJS';
const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const LOGIN_JS = read('login.js');
const APP_JS = read('app.js');

function configDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return path.dirname(process.execPath);
  return __dirname;
}

function loadConfig() {
  const file = path.join(configDir(), 'config.json');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify({ user: 'O_TEU_USER', password: 'A_TUA_PASSWORD', search: 'video' }, null, 2));
    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Video Team',
      message: 'Criei o config.json. Preenche o user e a password e volta a abrir.',
      detail: file,
    });
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function createWindow(cfg) {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    title: 'Video Team',
    backgroundColor: '#0C1020',
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: { partition: 'persist:7eventos' },
  });
  win.maximize();

  // links para fora (propostas, etc.) abrem no browser normal
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.on('page-title-updated', (e) => e.preventDefault());

  let loginAttempts = 0;
  const loginCfg = JSON.stringify({ user: cfg.user, password: cfg.password });
  const appCfg = JSON.stringify({ search: cfg.search || 'video' });

  win.webContents.on('dom-ready', async () => {
    const url = win.webContents.getURL();
    try {
      if (/\/Account\/Login/i.test(url)) {
        if (loginAttempts >= 2) return;
        const res = await win.webContents.executeJavaScript(`(${LOGIN_JS})(${loginCfg})`);
        if (res === 'submitted') loginAttempts++;
        if (res === 'loginerror') {
          loginAttempts = 2;
          dialog.showMessageBox(win, { type: 'error', title: 'Video Team', message: 'Login falhou. Confirma o user e a password no config.json.' });
        }
      } else if (url.startsWith(START)) {
        loginAttempts = 0;
        await win.webContents.executeJavaScript(`(${APP_JS})(${appCfg})`);
      }
    } catch (e) {
      console.error('[videoteam]', e);
    }
  });

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    win.webContents.executeJavaScript(`document.body.innerHTML = '<div style="font:15px system-ui;padding:40px;text-align:center"><h2>Sem ligação ao 7Eventos</h2><p>${desc}</p><button onclick="location.href=\\'${START}\\'" style="font:inherit;padding:8px 16px">Tentar de novo</button></div>'`).catch(() => {});
  });

  win.loadURL(START);
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'Ver', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'toggleDevTools' }] },
]));

app.whenReady().then(() => {
  const cfg = loadConfig();
  if (!cfg) return app.quit();
  createWindow(cfg);
});

app.on('window-all-closed', () => app.quit());

// teste: VT_SHOT=ficheiro.png tira um print ao fim de VT_WAIT ms e sai
if (process.env.VT_SHOT) {
  app.whenReady().then(() => setTimeout(async () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (process.env.VT_SIZE) { const [W, H] = process.env.VT_SIZE.split('x').map(Number); w.unmaximize(); w.setContentSize(W, H); await new Promise((r) => setTimeout(r, 1500)); }
    if (process.env.VT_JS) await w.webContents.executeJavaScript(process.env.VT_JS).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    fs.writeFileSync(process.env.VT_SHOT, (await w.webContents.capturePage()).toPNG());
    app.quit();
  }, +(process.env.VT_WAIT || 25000)));
}
