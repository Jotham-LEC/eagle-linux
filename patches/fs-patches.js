const fs = require('fs');
const path = require('path');

const eagleStubsDir = path.resolve(__dirname, '..');

// Original fs methods, captured before any interception below
const origFs = {
  existsSync: fs.existsSync,
  accessSync: fs.accessSync,
  access: fs.access,
  readFileSync: fs.readFileSync,
  readFile: fs.readFile,
  writeFileSync: fs.writeFileSync,
  writeFile: fs.writeFile,
  statSync: fs.statSync,
  stat: fs.stat,
  lstatSync: fs.lstatSync,
  lstat: fs.lstat,
  openSync: fs.openSync,
  open: fs.open,
  copyFileSync: fs.copyFileSync,
  unlinkSync: fs.unlinkSync
};

// Copy edge-cs.dll fallback to ProgramData/Eagle if expected by edge.js
try {
  const eagleTmpDir = path.join(process.env.ProgramData, 'Eagle');
  if (!fs.existsSync(eagleTmpDir)) {
    fs.mkdirSync(eagleTmpDir, { recursive: true });
  }
  const targetEdgeDll = path.join(eagleTmpDir, 'edge-cs.dll');
  if (!fs.existsSync(targetEdgeDll)) {
    fs.writeFileSync(targetEdgeDll, '');
  }
} catch (e) {}

// Windows paths Eagle probes at startup.
//
// Eagle reads the Windows hosts file on every platform but macOS, looking for
// its licence servers redirected to localhost. Point that one path at the real
// /etc/hosts, so the check reads the same file it reads on macOS. Nothing else
// is redirected: matching on substrings such as "hosts" or "drivers" used to
// hand user files like ~/Pictures/ghosts.png a fake hosts file and drop writes
// to anything under a folder called Drivers.
const WINDOWS_HOSTS = 'c:/windows/system32/drivers/etc/hosts';

function redirectHostsPath(p) {
  if (typeof p !== 'string') return p;
  return p.replace(/\\/g, '/').toLowerCase() === WINDOWS_HOSTS ? '/etc/hosts' : p;
}

// Runtime-library and system-file presence checks (validateRuntime). Eagle
// only tests that these exist; they are matched by file name, not substring.
const WINDOWS_SYSTEM_FILE = /(^|[\\/])(ipv4_data_[12]\.ldb|Certifications)$/;

function isWindowsSystemFile(p) {
  return typeof p === 'string' && WINDOWS_SYSTEM_FILE.test(p);
}

function isDllPath(p) {
  return typeof p === 'string' && p.toLowerCase().endsWith('.dll');
}

function isFakedPath(p) {
  return isWindowsSystemFile(p) || isDllPath(p);
}

// Dummy stat structure
const dummyStat = {
  isFile: () => true,
  isDirectory: () => false,
  isBlockDevice: () => false,
  isCharacterDevice: () => false,
  isSymbolicLink: () => false,
  isFIFO: () => false,
  isSocket: () => false,
  size: 1024,
  mtime: new Date(),
  atime: new Date(),
  ctime: new Date(),
  birthtime: new Date()
};

fs.existsSync = function(p) {
  if (typeof p === 'string' && (p.endsWith('DisableEdge') || p.includes('edge_coreclr') || p.includes('edge_nativeclr') || p.includes('electron-edge-js'))) return true;
  if (typeof p === 'string' && (p.includes('NiuniuCapture.exe') || p.includes('NiuniuCapture.dll'))) return true;
  if (isFakedPath(p)) return true;
  return origFs.existsSync.call(this, redirectHostsPath(p));
};

fs.accessSync = function(p, mode) {
  if (isFakedPath(p)) return undefined;
  return origFs.accessSync.call(this, redirectHostsPath(p), mode);
};

fs.access = function(p, ...args) {
  const cb = args.find(a => typeof a === 'function');
  if (isFakedPath(p)) {
    if (cb) process.nextTick(() => cb(null));
    return;
  }
  return origFs.access.call(this, redirectHostsPath(p), ...args);
};

fs.statSync = function(p, opts) {
  if (isFakedPath(p)) return dummyStat;
  return origFs.statSync.call(this, redirectHostsPath(p), opts);
};

fs.stat = function(p, ...args) {
  const cb = args.find(a => typeof a === 'function');
  if (isFakedPath(p)) {
    if (cb) process.nextTick(() => cb(null, dummyStat));
    return;
  }
  return origFs.stat.call(this, redirectHostsPath(p), ...args);
};

fs.readFileSync = function(p, opts) {
  if (isWindowsSystemFile(p)) return Buffer.alloc(64);
  return origFs.readFileSync.call(fs, redirectHostsPath(p), opts);
};

fs.readFile = function(p, ...args) {
  if (isWindowsSystemFile(p)) {
    const cb = args.find(a => typeof a === 'function');
    if (cb) process.nextTick(() => cb(null, Buffer.alloc(64)));
    return;
  }
  return origFs.readFile.call(fs, redirectHostsPath(p), ...args);
};

// Cross-filesystem / EXDEV fallback for fs.renameSync, fs.rename, and fs.promises.rename
const origRenameSync = fs.renameSync;
fs.renameSync = function(oldPath, newPath) {
  console.log('[STUBS RENAME SYNC]:', oldPath, '->', newPath);
  try {
    return origRenameSync.call(fs, oldPath, newPath);
  } catch (err) {
    console.log('[STUBS RENAME SYNC ERROR]:', err ? err.message : err);
    if (err && (err.code === 'EXDEV' || err.code === 'ENOENT')) {
      try {
        origFs.copyFileSync.call(fs, oldPath, newPath);
        origFs.unlinkSync.call(fs, oldPath);
        return;
      } catch (e) {}
    }
    throw err;
  }
};

const origRename = fs.rename;
fs.rename = function(oldPath, newPath, cb) {
  console.log('[STUBS RENAME ASYNC]:', oldPath, '->', newPath);
  return origRename.call(fs, oldPath, newPath, (err) => {
    if (err) console.log('[STUBS RENAME ASYNC ERROR]:', err.message);
    if (err && (err.code === 'EXDEV' || err.code === 'ENOENT')) {
      try {
        origFs.copyFileSync.call(fs, oldPath, newPath);
        origFs.unlinkSync.call(fs, oldPath);
        if (typeof cb === 'function') return cb(null);
      } catch (e) {
        if (typeof cb === 'function') return cb(err);
      }
    }
    if (typeof cb === 'function') return cb(err);
  });
};

if (fs.promises) {
  const origPromisesRename = fs.promises.rename;
  fs.promises.rename = async function(oldPath, newPath) {
    console.log('[STUBS PROMISES RENAME]:', oldPath, '->', newPath);
    try {
      return await origPromisesRename.call(fs.promises, oldPath, newPath);
    } catch (err) {
      console.log('[STUBS PROMISES RENAME ERROR]:', err ? err.message : err);
      if (err && (err.code === 'EXDEV' || err.code === 'ENOENT')) {
        try {
          origFs.copyFileSync.call(fs, oldPath, newPath);
          origFs.unlinkSync.call(fs, oldPath);
          return;
        } catch (e) {}
      }
      throw err;
    }
  };
}

// Intercept fs.copyFileSync / fs.copyFile for plugin installation
const origCopyFileSync = fs.copyFileSync;
fs.copyFileSync = function(src, dest, flags) {
  try {
    return origCopyFileSync.apply(this, arguments);
  } catch (err) {
    if (typeof dest === 'string' && (dest.includes('ffmpeg') || dest.includes('Plugins'))) {
      console.log(`[STUBS COPYFILE INTERCEPTED]: ${src} -> ${dest}`);
      return undefined;
    }
    throw err;
  }
};

const origCopyFile = fs.copyFile;
fs.copyFile = function(src, dest, ...args) {
  const cb = args.find(a => typeof a === 'function');
  try {
    return origCopyFile.call(fs, src, dest, ...args);
  } catch (err) {
    if (typeof dest === 'string' && (dest.includes('ffmpeg') || dest.includes('Plugins'))) {
      console.log(`[STUBS COPYFILE INTERCEPTED (async)]: ${src} -> ${dest}`);
      if (cb) process.nextTick(() => cb(null));
      return;
    }
    throw err;
  }
};

if (fs.promises) {
  const origPromises = { ...fs.promises };
  if (origPromises.readFile) {
    fs.promises.readFile = async function(p, opts) {
      if (isWindowsSystemFile(p)) return Buffer.alloc(64);
      return origPromises.readFile.call(this, redirectHostsPath(p), opts);
    };
  }
  if (origPromises.access) {
    fs.promises.access = async function(p, mode) {
      if (isFakedPath(p)) return undefined;
      return origPromises.access.call(this, redirectHostsPath(p), mode);
    };
  }
  if (origPromises.stat) {
    fs.promises.stat = async function(p, opts) {
      if (isFakedPath(p)) return dummyStat;
      return origPromises.stat.call(this, redirectHostsPath(p), opts);
    };
  }
  if (origPromises.copyFile) {
    fs.promises.copyFile = async function(src, dest, flags) {
      try {
        return await origPromises.copyFile.apply(this, arguments);
      } catch (err) {
        if (typeof dest === 'string' && (dest.includes('ffmpeg') || dest.includes('Plugins'))) {
          console.log(`[STUBS PROMISES COPYFILE INTERCEPTED]: ${src} -> ${dest}`);
          return undefined;
        }
        throw err;
      }
    };
  }
}

module.exports = {
  origFs,
  redirectHostsPath,
  isDllPath,
  dummyStat
};
