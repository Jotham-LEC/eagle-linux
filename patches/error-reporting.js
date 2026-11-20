// ==========================================================================
// Uncaught errors: logged, never silently dropped
//
// Registering any listener keeps Node from exiting on an uncaught error, which
// is what the compatibility layer needs: plenty of Eagle's Windows-only code
// paths still throw on Linux. Every error is written with its stack to stderr
// and appended to ~/.config/Eagle/eagle-linux-errors.log, which is cut back
// to empty once it passes 1 MiB.
// ==========================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOG_PATH = path.join(os.homedir(), '.config', 'Eagle', 'eagle-linux-errors.log');
const LOG_LIMIT = 1024 * 1024;

try {
  if (fs.statSync(LOG_PATH).size > LOG_LIMIT) fs.truncateSync(LOG_PATH, 0);
} catch (e) {}

function report(kind, err) {
  const detail = (err && err.stack) || String(err);
  const line = `[${new Date().toISOString()}] [${process.type || 'main'} ${process.pid}] ${kind}: ${detail}\n`;
  console.error(line.trimEnd());
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch (e) {}
}

process.on('uncaughtException', (err) => report('uncaught exception', err));
process.on('unhandledRejection', (reason) => report('unhandled rejection', reason));

module.exports = { LOG_PATH, report };
