'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const WebSocket = require('ws');
const { execSync } = require('child_process');

// ── Paths ─────────────────────────────────────────────────────
const IS_PACKED   = app.isPackaged;
const ROOT        = IS_PACKED ? process.resourcesPath : path.join(__dirname, '..');
const CEP_BASE    = path.join(process.env.APPDATA || '', 'Adobe', 'CEP', 'extensions');
const PREFS_FILE  = path.join(app.getPath('userData'), 'prefs.json');
const LOG_FILE    = path.join(app.getPath('temp'), 'adobe_bridge.log');
const ICON_PATH   = path.join(ROOT, 'assets', 'icon.ico');
const PORT        = 61900;
const FIGMA_HTTP_PORT = 61901;

// ── State ─────────────────────────────────────────────────────
let tray, mainWin, wss, figmaServer;
const hosts = {};

// ── Bridge definitions ────────────────────────────────────────
const DEFAULT_BRIDGES = {
  indesign: {
    name: 'InDesign to After Effects',
    description: 'Push frames and layers from InDesign to AE comps.',
    icon: 'id',
    id: 'com.idbridge',
    type: 'cep'
  },
  figma: {
    name: 'Figma to After Effects',
    description: 'Push selected Figma layers directly to AE.',
    icon: 'figma',
    id: 'com.figmabridge',
    type: 'figma'
  },
  illustrator: {
    name: 'Illustrator to After Effects',
    description: 'Push Illustrator artboards to AE comps.',
    icon: 'ai',
    id: 'com.aibridge',
    type: 'cep',
    comingSoon: true
  },
  photoshop: {
    name: 'Photoshop to After Effects',
    description: 'Push Photoshop layers to AE comps.',
    icon: 'ps',
    id: 'com.psbridge',
    type: 'cep',
    comingSoon: true
  }
};

// ── Logging ───────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch(e) {}
  if (!IS_PACKED) console.log(msg);
}

// ── Prefs ─────────────────────────────────────────────────────
function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch(e) { return {}; }
}
function savePrefs(p) {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)); } catch(e) {}
}

// ── CEP install helpers ───────────────────────────────────────
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function setRegistry() {
  for (let v = 9; v <= 12; v++) {
    try {
      execSync(
        `reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f`,
        { stdio: 'ignore' }
      );
    } catch(e) {}
  }
}

function installCEPBridge(bridgeKey) {
  const cepSrc = path.join(ROOT, 'cep');
  const cfg = DEFAULT_BRIDGES[bridgeKey];
  if (!cfg || cfg.type !== 'cep') return false;

  for (const ext of [cfg.id + '.main', cfg.id + '.listener']) {
    const src = path.join(cepSrc, ext);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(CEP_BASE, ext);
    try {
      if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true });
      copyDir(src, dst);
      log(`Installed CEP: ${ext}`);
    } catch(e) {
      log(`Failed to install ${ext}: ${e.message}`);
      return false;
    }
  }

  const aeId  = 'com.aebridge.listener';
  const aeSrc = path.join(cepSrc, aeId);
  if (fs.existsSync(aeSrc)) {
    const aeDst = path.join(CEP_BASE, aeId);
    try {
      if (fs.existsSync(aeDst)) fs.rmSync(aeDst, { recursive: true });
      copyDir(aeSrc, aeDst);
      log('Installed AE receiver');
    } catch(e) { log(`AE receiver: ${e.message}`); }
  }

  setRegistry();
  return true;
}

function uninstallCEPBridge(bridgeKey) {
  const cfg = DEFAULT_BRIDGES[bridgeKey];
  if (!cfg) return;
  for (const ext of [cfg.id + '.main', cfg.id + '.listener']) {
    const dst = path.join(CEP_BASE, ext);
    try { if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true }); } catch(e) {}
  }
  log(`Uninstalled: ${bridgeKey}`);
}

// ── Figma plugin install ──────────────────────────────────────
function startFigmaHTTPServer() {
  if (figmaServer) return;
  const pluginDir = path.join(ROOT, 'figma-plugin');

  figmaServer = http.createServer((req, res) => {
    let filePath = path.join(pluginDir, req.url === '/' ? 'manifest.json' : req.url);
    try {
      const data = fs.readFileSync(filePath);
      const ext  = path.extname(filePath);
      const mime = { '.json': 'application/json', '.js': 'application/javascript', '.html': 'text/html' }[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime, 'Access-Control-Allow-Origin': '*' });
      res.end(data);
    } catch(e) {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  figmaServer.listen(FIGMA_HTTP_PORT, '127.0.0.1', () => {
    log(`Figma HTTP server on port ${FIGMA_HTTP_PORT}`);
  });
  figmaServer.on('error', (e) => log(`Figma HTTP server error: ${e.message}`));
}

function getFigmaPluginDir() {
  const dest = path.join(app.getPath('userData'), 'figma-plugin');
  const src  = path.join(ROOT, 'figma-plugin');
  if (!fs.existsSync(dest) && fs.existsSync(src)) {
    copyDir(src, dest);
  }
  return dest;
}

function installFigmaBridge() {
  try {
    const pluginDir = getFigmaPluginDir();
    const aeId  = 'com.aebridge.listener';
    const aeSrc = path.join(ROOT, 'cep', aeId);
    if (fs.existsSync(aeSrc)) {
      const aeDst = path.join(CEP_BASE, aeId);
      if (!fs.existsSync(aeDst)) {
        copyDir(aeSrc, aeDst);
        setRegistry();
        log('Installed AE receiver for Figma bridge');
      }
    }
    startFigmaHTTPServer();
    log(`Figma plugin ready at: ${pluginDir}`);
    return { ok: true, pluginDir };
  } catch(e) {
    log(`Figma install error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function uninstallFigmaBridge() {
  if (figmaServer) {
    figmaServer.close();
    figmaServer = null;
    log('Figma HTTP server stopped');
  }
  log('Figma bridge uninstalled');
}

// ── WebSocket server ──────────────────────────────────────────
function startWS() {
  wss = new WebSocket.Server({ port: PORT });
  log(`WebSocket router on port ${PORT}`);

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch(e) { return; }

      if (msg.type === 'join-overlord' || msg.type === 'register') {
        const hostName = msg.data?.hostName || msg.hostName || 'unknown';
        ws._hostName = hostName;
        hosts[hostName] = ws;
        log(`Joined: ${hostName}`);
        send(ws, { type: 'connected', data: { expire: '2099-01-01' } });
        broadcastHostUpdate();
        updateTray();
        return;
      }

      if (msg.type === 'save-prefs') {
        const p = loadPrefs();
        p.panelPrefs = { ...(p.panelPrefs || {}), ...msg.data?.prefs };
        savePrefs(p);
        return;
      }

      if (msg.type === 'action') {
        const { to, ...rest } = msg;
        if (to === 'ALL') {
          for (const [name, client] of Object.entries(hosts)) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              send(client, { type: 'action', ...rest });
            }
          }
        } else if (to && hosts[to]) {
          send(hosts[to], { type: 'action', ...rest });
        }
        return;
      }
    });

    ws.on('close', () => {
      if (ws._hostName) {
        delete hosts[ws._hostName];
        broadcastHostUpdate();
        log(`Left: ${ws._hostName}`);
        updateTray();
      }
    });

    ws.on('error', (e) => log(`WS error: ${e.message}`));
  });
}

function send(ws, obj) {
  try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); } catch(e) {}
}

function broadcastHostUpdate() {
  const hostList = Object.keys(hosts).map(h => ({ hostName: h, id: h }));
  const prefs    = loadPrefs().panelPrefs || {};
  for (const ws of wss.clients) {
    send(ws, { type: 'hosts-update', data: { hostList, prefs } });
  }
}

// ── Tray ──────────────────────────────────────────────────────
function createTray() {
  let icon;
  try { icon = nativeImage.createFromPath(ICON_PATH); }
  catch(e) { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  tray.setToolTip('Adobe Bridge');
  tray.on('click', showMain);
  updateTray();
}

function updateTray() {
  const prefs = loadPrefs();
  const connectedApps = Object.keys(hosts);

  const items = [
    { label: 'Adobe Bridge', enabled: false },
    { type: 'separator' },
    { label: `Connected: ${connectedApps.length ? connectedApps.join(', ') : 'none'}`, enabled: false },
    { type: 'separator' },
    { label: 'Bridge Manager', click: showMain },
    { label: 'Open log', click: () => shell.openPath(LOG_FILE) },
    { type: 'separator' }
  ];

  for (const [key, cfg] of Object.entries(DEFAULT_BRIDGES)) {
    const installed = (prefs.bridges || {})[key]?.installed;
    items.push({
      label: `${cfg.name}: ${installed ? 'Installed' : 'Not installed'}`,
      enabled: false
    });
  }

  items.push({ type: 'separator' });
  items.push({ label: 'Quit', click: () => app.quit() });

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ── Manager window ────────────────────────────────────────────
function showMain() {
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); return; }

  mainWin = new BrowserWindow({
    width: 500, height: 640,
    resizable: false,
    title: 'Adobe Bridge',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    icon: ICON_PATH
  });
  mainWin.loadFile(path.join(__dirname, 'manager.html'));
  mainWin.setMenuBarVisibility(false);
  mainWin.on('closed', () => { mainWin = null; });

  mainWin.webContents.on('did-finish-load', () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    mainWin.webContents.send('init', {
      bridges: DEFAULT_BRIDGES,
      prefs: loadPrefs(),
      connected: Object.keys(hosts)
    });
  });
}

// ── IPC ───────────────────────────────────────────────────────
ipcMain.on('install-bridge', (e, bridgeKey) => {
  const cfg = DEFAULT_BRIDGES[bridgeKey];
  if (!cfg) { e.reply('install-result', { bridgeKey, ok: false }); return; }

  let ok = false;
  let extra = {};

  if (cfg.type === 'figma') {
    const result = installFigmaBridge();
    ok = result.ok;
    extra = { pluginDir: result.pluginDir };
  } else {
    ok = installCEPBridge(bridgeKey);
  }

  if (ok) {
    const p = loadPrefs();
    p.bridges = p.bridges || {};
    p.bridges[bridgeKey] = { installed: true };
    savePrefs(p);
  }

  e.reply('install-result', { bridgeKey, ok, ...extra });
  updateTray();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('prefs-updated', loadPrefs());
  }
});

ipcMain.on('uninstall-bridge', (e, bridgeKey) => {
  const cfg = DEFAULT_BRIDGES[bridgeKey];
  if (cfg?.type === 'figma') {
    uninstallFigmaBridge();
  } else {
    uninstallCEPBridge(bridgeKey);
  }
  const p = loadPrefs();
  p.bridges = p.bridges || {};
  p.bridges[bridgeKey] = { installed: false };
  savePrefs(p);
  e.reply('install-result', { bridgeKey, ok: true, uninstalled: true });
  updateTray();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('prefs-updated', loadPrefs());
  }
});

ipcMain.on('get-state', (e) => {
  e.reply('state', { bridges: DEFAULT_BRIDGES, prefs: loadPrefs(), connected: Object.keys(hosts) });
});

ipcMain.on('open-figma-plugin-dir', () => {
  const pluginDir = getFigmaPluginDir();
  shell.openPath(pluginDir);
});

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  app.setAppUserModelId('com.idbridge.app');

  const prefs = loadPrefs();
  if (prefs.bridges?.figma?.installed) {
    startFigmaHTTPServer();
  }

  startWS();
  createTray();
  showMain();
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => {
  if (figmaServer) figmaServer.close();
});
