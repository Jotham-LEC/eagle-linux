// ==========================================================================
// Global shortcuts from the compositor: eagle://shortcut/<action>
//
// Electron 22 has no global shortcuts under native Wayland, and wlroots
// compositors have no KGlobalAccel. Bind the key in the compositor instead and
// have it launch Eagle with a shortcut URL, e.g. in Sway:
//
//   bindsym Mod4+Shift+e exec eagle eagle://shortcut/global.capture.area
//
// Eagle is single-instance, so the launch lands in the running Eagle as a
// second-instance event, and the action is dispatched the same way the KDE
// integration does it. Action names are the keys of
// shortcuts.keybinds in Eagle's default-preferences.js.
// ==========================================================================

let electron;
try {
  electron = require('electron');
} catch (e) {}

const isMainProcess = !process.type || process.type === 'browser';
const SHORTCUT_URL = /^eagle:\/\/shortcut\/([a-z0-9]+(?:\.[a-z0-9]+)+)\/?$/i;

function actionFromArgv(argv) {
  for (const arg of argv || []) {
    const m = SHORTCUT_URL.exec(String(arg));
    if (m) return m[1];
  }
  return null;
}

function dispatch(actionKey) {
  const wins = electron.BrowserWindow.getAllWindows();
  const mainWin = wins.find(w => w && !w.isDestroyed() && w.getBounds().width > 200);
  if (!mainWin) {
    console.warn(`[STUBS SHORTCUT] No main window for ${actionKey}`);
    return;
  }
  // Raising Eagle for a capture would put Eagle itself in the screenshot.
  if (!actionKey.startsWith('global.capture.')) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.show();
    mainWin.focus();
  }
  console.log(`[STUBS SHORTCUT] Dispatching ${actionKey}`);
  mainWin.webContents.send('dispatch-shortcut', actionKey);
}

if (isMainProcess && electron && electron.app) {
  electron.app.on('second-instance', (event, argv) => {
    const actionKey = actionFromArgv(argv);
    if (actionKey) dispatch(actionKey);
  });
}

module.exports = { actionFromArgv, SHORTCUT_URL };
