/**
 * Eagle Linux Compatibility Layer - Master Patches Index
 *
 * Load order mirrors stubs.js and is significant:
 *
 *  - hardening must wrap app.commandLine before Eagle appends its switches.
 *  - environment must run before fs-patches: it defines process.env.ProgramData
 *    (used to seed the edge-cs.dll stub) and installs the path.join/resolve
 *    guards that tolerate undefined Windows env vars.
 *  - machine-id must precede process-execution and native-modules, which
 *    consume getMockRegOutput()/FakeWinreg.
 *  - native-modules must precede window-manager, which uses createCallableProxy.
 */

// 1. Drop the Chromium switches that turn off TLS checks and the sandbox.
//    (There is no anti-tamper hook: pristine-patches.js leaves every file
//    Eagle hashes untouched, and the build verifies that.)
const hardening = require('./hardening');

// 2. Linux PNG NativeImage / Tray icon resolution
const trayIcon = require('./tray-icon');

// 3. Environment: Windows env var fallbacks, GTK/GSettings, ffmpeg wrappers
const environment = require('./environment');

// 4. File system hooks
const fsPatches = require('./fs-patches');

// 5. Machine ID & Winreg
const machineId = require('./machine-id');

// 6. Process execution
const processExecution = require('./process-execution');

// 7. Module._load interception & native proxies
const nativeModules = require('./native-modules');

// 8. UI & Window management
const windowManager = require('./window-manager');

// 9. Native Wayland: static cursors (Chromium 108 cursor crash workaround)
const wayland = require('./wayland');

// 10. Drag-out: normalise startDrag(); HTML5 drag-out on Wayland
const dragOut = require('./drag-out');

// 11. Renderer-only fixes (no-op in the main process)
const rendererFixes = require('./renderer-fixes');

// 12. Dynamically-installed plugin patches & desktop integration.
//     AI Search rewrites plugin code downloaded into ~/.config/Eagle/Plugins,
//     so it only loads when the package was built with enableAiSearch.
const aiSearch = process.env.EAGLE_LINUX_AI_SEARCH === '1' ? require('./ai-search') : null;
const kdeShortcuts = require('./kde-shortcuts');
const swayShortcuts = require('./sway-shortcuts');

// 13. Errors stay visible. Any listener keeps Node from exiting, as the old
//     "SUPPRESSED" handlers did, but each error is now written with its stack
//     to stderr and to ~/.config/Eagle/eagle-linux-errors.log.
const errorReporting = require('./error-reporting');

console.log(`[PATCHES MASTER] Eagle Linux Compatibility Layer successfully initialized (process.type: ${process.type || 'main'}).`);

module.exports = {
  hardening,
  trayIcon,
  environment,
  fsPatches,
  machineId,
  processExecution,
  nativeModules,
  windowManager,
  wayland,
  dragOut,
  rendererFixes,
  aiSearch,
  kdeShortcuts,
  swayShortcuts,
  errorReporting
};
