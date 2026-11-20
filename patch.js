/**
 * Eagle Linux Compatibility Layer - Master Entry Point
 *
 * All compatibility patches are organized into dedicated modules under `./patches/`:
 *  - patches/hardening.js          : drops Eagle's TLS- and sandbox-disabling switches
 *  - patches/tray-icon.js          : Linux PNG NativeImage & Tray wrapper
 *  - patches/environment.js        : Windows env fallbacks, GTK/GSettings, ffmpeg wrappers
 *  - patches/fs-patches.js         : File system hooks, EXDEV rename fallback & dummy files
 *  - patches/machine-id.js         : System Machine GUID & FakeWinreg
 *  - patches/process-execution.js  : PowerShell binary discovery & child_process hooks
 *  - patches/native-modules.js     : Module._load/dlopen interception & native proxies
 *  - patches/file-clipboard.js     : Linux text/uri-list replacement for win-clipboard
 *  - patches/window-manager.js     : BrowserWindow wrapper, window controls, app lifecycle
 *  - patches/wayland.js            : Wayland detection & static cursor themes (cursor crash)
 *  - patches/drag-out.js           : startDrag() normalisation; HTML5 drag-out on Wayland
 *  - patches/autostart.js          : Shared XDG autostart .desktop helpers
 *  - patches/renderer-fixes.js     : Renderer-only window.ig & body display fixes
 *  - patches/ai-search.js          : AI Search plugin Linux compatibility
 *  - patches/kde-shortcuts.js      : KDE Plasma KGlobalAccel global shortcuts
 *  - patches/sway-shortcuts.js     : eagle://shortcut/<action> for compositor key bindings
 *  - patches/linux-screenshot.js   : grim/slurp on wlroots, the XDG portal elsewhere
 *  - patches/error-reporting.js    : uncaught errors to stderr and a log file
 *
 * See patches/index.js for the (significant) load order.
 */

module.exports = require('./patches/index.js');
