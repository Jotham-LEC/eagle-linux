const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const { getMockRegOutput, isMachineIdQuery } = require('./machine-id');

/* --------------------------------------------------------------------------
 * Resolve ffmpeg / ffprobe binaries by basename
 * -------------------------------------------------------------------------- */

function resolveMediaBin(cmdPath) {
  if (typeof cmdPath !== 'string') return cmdPath;

  const base = path.basename(cmdPath).toLowerCase();

  if (base.includes('ffprobe')) return 'ffprobe';
  if (base.includes('ffmpeg')) return 'ffmpeg';

  return cmdPath;
}


/* --------------------------------------------------------------------------
 * Original child_process functions
 * -------------------------------------------------------------------------- */

const origExecFile = child_process.execFile;
const origExecFileSync = child_process.execFileSync;
const origExecSync = child_process.execSync;
const origExec = child_process.exec;
const origSpawn = child_process.spawn;


/* --------------------------------------------------------------------------
 * execSync
 *
 * Normalise bundled Windows ffmpeg/ffprobe paths to the system binaries.
 * -------------------------------------------------------------------------- */

child_process.execSync = function(command, options) {

  if (typeof command === 'string') {

    command =
      command.replace(
        /(?:^|\s)([^\s"'`]*ffmpeg(?:\.exe)?)(?=\s|$)/gi,
        match => {
          const leading =
            match.match(/^\s*/)?.[0] || '';

          return leading + 'ffmpeg';
        }
      );

    command =
      command.replace(
        /(?:^|\s)([^\s"'`]*ffprobe(?:\.exe)?)(?=\s|$)/gi,
        match => {
          const leading =
            match.match(/^\s*/)?.[0] || '';

          return leading + 'ffprobe';
        }
      );
  }

  return origExecSync.call(
    child_process,
    command,
    options
  );
};

const mediaNormalisedExecSync = child_process.execSync;


/* --------------------------------------------------------------------------
 * PowerShell
 *
 * Eagle takes its Windows code path on Linux and asks for powershell.exe.
 * Each command it is known to send gets its own handler; anything else fails
 * as if powershell.exe were missing. Nothing is rewritten into a shell
 * command: the old fallback deleted the word "powershell" and passed the rest
 * to /bin/sh -c, where a filename or URL containing a quote would run as code.
 *
 * Known commands (Eagle 4.0 build 23):
 *   - registry MachineGuid queries          -> the machine-id mock
 *   - verifySystemClock (run.jsc):
 *       Remove-item alias:curl; curl -s -I -X POST <url>
 *                                           -> curl with an argument vector
 * -------------------------------------------------------------------------- */

const { EventEmitter } = require('events');
const { Readable, Writable } = require('stream');

const CLOCK_CHECK = /^Remove-item alias:curl; curl -s -I -X POST (https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~\/-]*)?)$/;

function isPowerShell(file) {
  return typeof file === 'string' && /(^|[\\/])(powershell|pwsh)(\.exe)?$/i.test(file.trim().replace(/^["']|["']$/g, ''));
}

function isRegistryQuery(text) {
  return isMachineIdQuery(text) || (typeof text === 'string' && (text.includes('HKLM:') || text.includes('Cryptography') || text.includes('MachineGuid')));
}

function powerShellUnavailable(script) {
  const err = new Error(`spawn powershell.exe ENOENT (eagle-linux has no handler for: ${String(script).slice(0, 200)})`);
  err.code = 'ENOENT';
  err.errno = -2;
  err.syscall = 'spawn powershell.exe';
  return err;
}

// exec and execFile report errors through their callback and always listen
// for 'error' on the child themselves; spawn leaves that to the caller.
function fakeProcess({ stdout = '', error = null, viaCallback = false } = {}) {
  const proc = new EventEmitter();
  if (viaCallback) proc.on('error', () => {});
  proc.stdout = new Readable({ read() { if (stdout) this.push(stdout); this.push(null); } });
  proc.stderr = new Readable({ read() { this.push(null); } });
  proc.stdin = new Writable({ write(chunk, enc, cb) { if (cb) cb(); } });
  proc.kill = () => {};
  process.nextTick(() => {
    if (error) {
      proc.emit('error', error);
      proc.emit('close', -2);
    } else {
      proc.emit('exit', 0);
      proc.emit('close', 0);
    }
  });
  return proc;
}

// The script text Eagle passes, whether as spawn/execFile arguments or as a
// whole command line handed to exec/execSync.
function scriptFromArgs(args) {
  return (Array.isArray(args) ? args : []).filter(a => !/^-(NoProfile|NonInteractive|Command)$/i.test(a)).join(' ').trim();
}

// exec/execSync get a whole command line, and Eagle may name PowerShell as
// the shell option instead (InDesign thumbnails). Refuse on any mention.
function namesPowerShell(cmd, opts) {
  const shell = opts && typeof opts === 'object' ? opts.shell : null;
  return [cmd, shell].some(s => typeof s === 'string' && /\b(powershell|pwsh)(\.exe)?\b/i.test(s));
}

function logPowerShell(how, script) {
  console.log(`[STUBS POWERSHELL ${how}]: ${String(script).slice(0, 200)}`);
}

child_process.execFileSync = function(file, args, options) {
  const cmdStr = (file || '') + ' ' + (Array.isArray(args) ? args.join(' ') : '');
  if (isMachineIdQuery(cmdStr)) {
    console.log('[STUBS MACHINE ID QUERY (execFileSync)]:', cmdStr);
    return getMockRegOutput();
  }
  if (isPowerShell(file)) {
    logPowerShell('REFUSED (execFileSync)', scriptFromArgs(args));
    throw powerShellUnavailable(scriptFromArgs(args));
  }
  const resolved = resolveMediaBin(file);
  if (resolved !== file) {
    console.log(`[STUBS EXECFILESYNC REDIRECT]: ${file} -> ${resolved}`);
    return origExecFileSync.call(this, resolved, args, options);
  }
  return origExecFileSync.call(this, file, args, options);
};

child_process.execFile = function(file, args, options, callback) {
  if (typeof args === 'function') { callback = args; args = []; options = null; }
  if (typeof options === 'function') { callback = options; options = null; }
  const cmdStr = (file || '') + ' ' + (Array.isArray(args) ? args.join(' ') : '');
  if (isMachineIdQuery(cmdStr)) {
    console.log('[STUBS MACHINE ID QUERY (execFile)]:', cmdStr);
    if (callback) process.nextTick(() => callback(null, getMockRegOutput(), ''));
    return fakeProcess({ stdout: getMockRegOutput() });
  }
  if (typeof file === 'string' && file.includes('NiuniuCapture')) {
    // Windows screenshot helper; Linux captures through linux-screenshot.js.
    const err = new Error('NiuniuCapture.exe is unavailable on Linux');
    if (callback) process.nextTick(() => callback(err, '', ''));
    return fakeProcess({ error: err, viaCallback: true });
  }
  if (isPowerShell(file)) {
    const err = powerShellUnavailable(scriptFromArgs(args));
    logPowerShell('REFUSED (execFile)', scriptFromArgs(args));
    if (callback) process.nextTick(() => callback(err, '', ''));
    return fakeProcess({ error: err, viaCallback: true });
  }
  const resolved = resolveMediaBin(file);
  if (resolved !== file) {
    console.log(`[STUBS EXECFILE REDIRECT]: ${file} -> ${resolved}`);
    return origExecFile.call(this, resolved, args, options, callback);
  }
  return origExecFile.call(this, file, args, options, callback);
};

child_process.execSync = function(cmd, opts) {
  if (isRegistryQuery(cmd)) {
    console.log('[STUBS MACHINE ID QUERY (execSync)]:', cmd);
    return getMockRegOutput();
  }
  if (namesPowerShell(cmd, opts)) {
    logPowerShell('REFUSED (execSync)', cmd);
    throw powerShellUnavailable(cmd);
  }
  return mediaNormalisedExecSync.apply(this, arguments);
};

child_process.exec = function(cmd, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = null; }
  if (isRegistryQuery(cmd)) {
    console.log('[STUBS MACHINE ID QUERY (exec)]:', cmd);
    if (cb) process.nextTick(() => cb(null, getMockRegOutput(), ''));
    return fakeProcess({ stdout: getMockRegOutput() });
  }
  if (namesPowerShell(cmd, opts)) {
    const err = powerShellUnavailable(cmd);
    logPowerShell('REFUSED (exec)', cmd);
    if (cb) process.nextTick(() => cb(err, '', ''));
    return fakeProcess({ error: err, viaCallback: true });
  }
  return origExec.call(this, cmd, opts, cb);
};

child_process.spawn = function(command, args, options) {
  const resolved = resolveMediaBin(command);
  if (resolved !== command) {
    console.log(`[STUBS SPAWN REDIRECT]: ${command} -> ${resolved}`);
    return origSpawn.call(this, resolved, args, options);
  }

  if (isPowerShell(command)) {
    const script = scriptFromArgs(args);

    if (isRegistryQuery(script)) {
      logPowerShell('-> REGISTRY MOCK', script);
      return fakeProcess({ stdout: getMockRegOutput() });
    }

    const clock = CLOCK_CHECK.exec(script);
    if (clock) {
      logPowerShell('-> CURL (clock check)', script);
      return origSpawn.call(this, 'curl', ['-s', '-I', '-X', 'POST', clock[1]], options);
    }

    logPowerShell('REFUSED (spawn)', script);
    return fakeProcess({ error: powerShellUnavailable(script) });
  }

  if (typeof command === 'string' && /(^|[\\/])cmd\.exe$/i.test(command)) {
    console.log('[STUBS CMD.EXE STUBBED]:', command);
    return fakeProcess();
  }

  return origSpawn.apply(this, arguments);
};

module.exports = {
  isPowerShell,
  resolveMediaBin,
  CLOCK_CHECK
};
