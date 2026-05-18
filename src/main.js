// Adobe Bridge - Main Electron Process
// Tray app + WebSocket router (port 61900)
// Routes: InDesign/Illustrator/Photoshop -> After Effects

const { app, Tray, Menu, BrowserWindow, nativeImage, shell } = require('electron');
const WebSocket = require('ws');
const { execSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ── Config ────────────────────────────────────────────────────
const PORT       = 61900;
const LOG_FILE   = path.join(os.tmpdir(), 'adobe_bridge.log');
const ICON_PATH  = path.join(__dirname, '..', 'assets', 'icon.ico');
const CEP_BASE   = path.join(process.env.APPDATA || '', 'Adobe', 'CEP', 'extensions');

// ── Installed bridges config (persisted to userData) ─────────
const PREFS_FILE = path.join(app.getPath('userData'), 'bridges.json');
const DEFAULT_BRIDGES = {
  indesign:    { id: 'com.idbridge',  name: 'InDesign -> AE',       installed: false },
  illustrator: { id: 'com.aibridge',  name: 'Illustrator -> AE',    installed: false },
  photoshop:   { id: 'com.psbridge',  name: 'Photoshop -> AE',      installed: false }
};

function loadPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8')); } catch(e) { return {}; }
}
function savePrefs(p) {
  try { fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)); } catch(e) {}
}

// ── State ─────────────────────────────────────────────────────
let tray = null, wss = null, mainWin = null;
const hosts = {}; // hostName -> WebSocket

// ── Single instance ───────────────────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); }

// ── Logging ───────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch(e) {}
}

// ── CEP helpers ───────────────────────────────────────────────
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function setRegistry() {
  for (let v = 9; v <= 12; v++) {
    try { execSync(`reg add "HKCU\\Software\\Adobe\\CSXS.${v}" /v PlayerDebugMode /t REG_SZ /d 1 /f`, { stdio: 'ignore' }); }
    catch(e) {}
  }
}

function installBridge(bridgeKey) {
  const cepSrc = path.join(process.resourcesPath || path.join(__dirname,'..'), 'cep');
  const cfg = DEFAULT_BRIDGES[bridgeKey];
  if (!cfg) return false;

  // Install source panel (push side: ID/AI/PS)
  const srcId = cfg.id + '.main'; // not needed separately - listener handles it
  const listId = cfg.id + '.listener';

  for (const ext of [cfg.id + '.main', listId]) {
    const src = path.join(cepSrc, ext);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(CEP_BASE, ext);
    try {
      if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true });
      copyDir(src, dst);
      log(`Installed CEP: ${ext}`);
    } catch(e) { log(`Failed: ${ext} - ${e.message}`); return false; }
  }

  // AE receiver (shared across all bridges)
  const aeId = 'com.aebridge.listener';
  const aeSrc = path.join(cepSrc, aeId);
  if (fs.existsSync(aeSrc)) {
    const aeDst = path.join(CEP_BASE, aeId);
    try {
      if (fs.existsSync(aeDst)) fs.rmSync(aeDst, { recursive: true });
      copyDir(aeSrc, aeDst);
      log(`Installed AE receiver`);
    } catch(e) {}
  }

  setRegistry();
  return true;
}

function uninstallBridge(bridgeKey) {
  const cfg = DEFAULT_BRIDGES[bridgeKey];
  if (!cfg) return;
  for (const ext of [cfg.id + '.main', cfg.id + '.listener']) {
    const dst = path.join(CEP_BASE, ext);
    try { if (fs.existsSync(dst)) fs.rmSync(dst, { recursive: true }); } catch(e) {}
  }
  log(`Uninstalled: ${bridgeKey}`);
}

// ── WebSocket server ──────────────────────────────────────────
function startWS() {
  wss = new WebSocket.Server({ port: PORT });
  log(`WebSocket started on port ${PORT}`);

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch(e) { return; }

      // Client announces itself
      if (msg.type === 'join-overlord' || msg.type === 'register') {
        const hostName = msg.data?.hostName || msg.hostName || 'unknown';
        ws._hostName = hostName;
        hosts[hostName] = ws;
        log(`Joined: ${hostName}`);

        // Send connected confirmation + current host list
        send(ws, { type: 'connected', data: { expire: '2099-01-01' } });
        broadcastHostUpdate();
        return;
      }

      // Save prefs from any panel
      if (msg.type === 'save-prefs') {
        const p = loadPrefs();
        p.panelPrefs = { ...(p.panelPrefs||{}), ...msg.data?.prefs };
        savePrefs(p);
        return;
      }

      // Route action messages
      if (msg.type === 'action') {
        const { to, data } = msg;
        if (to === 'ALL') {
          for (const [name, client] of Object.entries(hosts)) {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              send(client, { type: 'action', ...data });
            }
          }
        } else if (to && hosts[to]) {
          send(hosts[to], { type: 'action', ...data });
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
  const prefs = loadPrefs().panelPrefs || {};
  for (const ws of wss.clients) {
    send(ws, { type: 'hosts-update', data: { hostList, prefs } });
  }
  updateTray();
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
  const connectedApps = Object.keys(hosts);
  const prefs = loadPrefs();

  const items = [
    { label: 'Adobe Bridge', enabled: false },
    { type: 'separator' },
    { label: `Connected: ${connectedApps.length > 0 ? connectedApps.join(', ') : 'none'}`, enabled: false },
    { type: 'separator' },
    { label: 'Bridge Manager', click: showMain },
    { label: 'Open log', click: () => shell.openPath(LOG_FILE) },
    { type: 'separator' }
  ];

  // Bridge toggle items
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

// ── Main window (Bridge Manager) ──────────────────────────────
function showMain() {
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); return; }

  mainWin = new BrowserWindow({
    width: 480, height: 580,
    resizable: false,
    title: 'Adobe Bridge',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    icon: ICON_PATH
  });
  mainWin.loadFile(path.join(__dirname, 'manager.html'));
  mainWin.setMenuBarVisibility(false);
  mainWin.on('closed', () => { mainWin = null; });

  // Pass state to window
  mainWin.webContents.on('did-finish-load', () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    mainWin.webContents.send('init', {
      bridges: DEFAULT_BRIDGES,
      prefs: loadPrefs(),
      connected: Object.keys(hosts)
    });
  });
}

// ── IPC from manager window ───────────────────────────────────
const { ipcMain } = require('electron');

ipcMain.on('install-bridge', (e, bridgeKey) => {
  const ok = installBridge(bridgeKey);
  if (ok) {
    const p = loadPrefs();
    p.bridges = p.bridges || {};
    p.bridges[bridgeKey] = { installed: true };
    savePrefs(p);
  }
  e.reply('install-result', { bridgeKey, ok });
  updateTray();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('prefs-updated', loadPrefs());
  }
});

ipcMain.on('uninstall-bridge', (e, bridgeKey) => {
  uninstallBridge(bridgeKey);
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

// ── App lifecycle ─────────────────────────────────────────────
app.whenReady().then(() => {
  if (app.dock) app.dock.hide();
  app.setAppUserModelId('com.idbridge.app');

  // First run: set registry
  const flagFile = path.join(app.getPath('userData'), 'initialized');
  if (!fs.existsSync(flagFile)) {
    setRegistry();
    try { fs.writeFileSync(flagFile, '1'); } catch(e) {}
  }

  startWS();
  createTray();
  showMain(); // show manager on first launch
  log('Adobe Bridge started, port ' + PORT);
});

app.on('window-all-closed', () => {}); // stay in tray
app.on('before-quit', () => { if (wss) wss.close(); log('Bridge stopped'); });
