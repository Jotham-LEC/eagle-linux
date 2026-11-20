// ==========================================================================
// Linux screenshots for Eagle's ScreenCapture (renderer process)
//
// pristine-patches.js routes ScreenCapture.capture() here on Linux.
// Eagle modes: 1 = window, 2 = area, 3 = full screen.
//
// wlroots compositors (Sway, Hyprland, river...): grim, with slurp to pick the
// area. This is what xdg-desktop-portal-wlr itself runs, but the portal always
// writes to /tmp/out.png in the host's /tmp, which a sandboxed Eagle does not
// share. Running grim directly writes straight to Eagle's temp file. Window
// mode is an area pick too: naming windows would need the compositor's IPC
// socket, and that socket can run any command outside a sandbox.
//
// Everywhere else (KDE, GNOME): org.freedesktop.portal.Screenshot.
// ==========================================================================

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const APP_DIR = path.join(__dirname, '..', 'app');

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${file} failed: ${(stderr || '').trim() || err.message}`;
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function onPath(bin) {
  return (process.env.PATH || '').split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch (e) {
      return false;
    }
  });
}

function isWlroots() {
  const desktop = (process.env.XDG_CURRENT_DESKTOP || '').toLowerCase();
  if (!process.env.WAYLAND_DISPLAY) return false;
  if (/kde|gnome|unity|cinnamon|xfce/.test(desktop)) return false;
  return onPath('grim') && onPath('slurp');
}

async function grimCapture(mode, tempPath) {
  if (mode === 3) {
    await run('grim', ['-t', 'png', tempPath]);
    return;
  }
  let geometry;
  try {
    geometry = await run('slurp', []);
  } catch (err) {
    throw new Error('Screenshot cancelled');
  }
  await run('grim', ['-t', 'png', '-g', geometry, tempPath]);
}

async function portalCapture(mode, tempPath) {
  const dbus = require(require.resolve('dbus-next', { paths: [APP_DIR] }));
  const bus = dbus.sessionBus();
  try {
    const desktop = await bus.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop');
    const screenshot = desktop.getInterface('org.freedesktop.portal.Screenshot');
    const token = `eagle_${process.pid}_${Date.now()}`;
    const requestPath = await screenshot.Screenshot('', {
      handle_token: new dbus.Variant('s', token),
      interactive: new dbus.Variant('b', mode !== 3),
    });
    const requestObject = await bus.getProxyObject('org.freedesktop.portal.Desktop', requestPath);
    const request = requestObject.getInterface('org.freedesktop.portal.Request');
    const [code, results] = await new Promise((resolve) => {
      request.on('Response', (responseCode, res) => resolve([responseCode, res]));
    });
    if (code !== 0) throw new Error(code === 1 ? 'Screenshot cancelled' : `Screenshot portal returned ${code}`);
    const uri = results && results.uri && results.uri.value;
    if (typeof uri !== 'string' || !uri.startsWith('file://')) {
      throw new Error(`Screenshot portal returned no file URI: ${uri}`);
    }
    fs.copyFileSync(decodeURIComponent(new URL(uri).pathname), tempPath);
  } finally {
    bus.disconnect();
  }
}

async function capture({ mode, tempPath }) {
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  if (isWlroots()) {
    await grimCapture(mode, tempPath);
  } else {
    await portalCapture(mode, tempPath);
  }
  const stat = fs.statSync(tempPath);
  if (!stat.isFile() || stat.size === 0) throw new Error(`Screenshot produced no image at ${tempPath}`);
  return tempPath;
}

module.exports = { capture, isWlroots };
