// ==========================================================================
// Chromium switches Eagle must not set
//
// Eagle's main process (run.jsc) carries these switch names among the ones it
// appends at startup:
//
//   ignore-certificate-errors  accept any TLS certificate, for every request
//   no-sandbox                 turn off the Chromium sandbox
//   disable-gpu-sandbox        turn off the GPU process sandbox
//
// Electron 22 is Chromium 108, out of support since 2023, and Eagle loads
// remote pages (web capture, the plugin centre). With certificate errors
// ignored, anyone on the network path can serve those pages. Each blocked
// switch is logged so it is visible which ones Eagle actually tries to set.
// Node's own TLS connections get the same treatment below.
// ==========================================================================

const BLOCKED = new Set(['ignore-certificate-errors', 'no-sandbox', 'disable-gpu-sandbox']);

function normalise(name) {
  return String(name).replace(/^-+/, '').split('=')[0].toLowerCase();
}

let electron;
try {
  electron = require('electron');
} catch (e) {}

const isMainProcess = !process.type || process.type === 'browser';
const blocked = [];

if (isMainProcess && electron && electron.app && electron.app.commandLine) {
  const commandLine = electron.app.commandLine;
  const origAppendSwitch = commandLine.appendSwitch.bind(commandLine);
  const origAppendArgument = commandLine.appendArgument.bind(commandLine);

  commandLine.appendSwitch = function (name, value) {
    if (BLOCKED.has(normalise(name))) {
      blocked.push(normalise(name));
      console.warn(`[HARDENING] Refused Chromium switch: ${name}`);
      return;
    }
    return origAppendSwitch(name, value);
  };

  commandLine.appendArgument = function (arg) {
    if (BLOCKED.has(normalise(arg))) {
      blocked.push(normalise(arg));
      console.warn(`[HARDENING] Refused Chromium argument: ${arg}`);
      return;
    }
    return origAppendArgument(arg);
  };
}

// Node-side TLS: run.jsc also sets rejectUnauthorized on a request of its own.
// https.request reaches tls.connect through the module object, so forcing the
// option here covers every Node HTTPS connection in the process.
const tls = require('tls');
const origTlsConnect = tls.connect;
tls.connect = function (...args) {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && arg.rejectUnauthorized === false) {
      console.warn(`[HARDENING] Re-enabled TLS verification for ${arg.servername || arg.host || 'a connection'}`);
      arg.rejectUnauthorized = true;
    }
  }
  return origTlsConnect.apply(this, args);
};

module.exports = { BLOCKED, blocked };
