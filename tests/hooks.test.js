// Run with: node --test tests/
// Exercises the child_process and fs hooks outside Electron.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// A private HOME and a PATH whose only curl records its arguments.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'eagle-hooks-'));
const bin = path.join(scratch, 'bin');
const curlLog = path.join(scratch, 'curl-args');
const canary = path.join(scratch, 'canary');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'curl'), `#!/bin/sh\nprintf '%s\\n' "$@" > '${curlLog}'\n`, { mode: 0o755 });
process.env.HOME = scratch;
process.env.PATH = `${bin}:${process.env.PATH}`;
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

const child_process = require('node:child_process');
require('../patches/process-execution');

function waitForSpawn(proc) {
  return new Promise((resolve) => {
    proc.on('error', (err) => resolve({ err }));
    proc.on('close', (code) => resolve({ code }));
  });
}

test('the clock check runs curl with an argument vector', async () => {
  const url = 'https://en.eagle.cool/check-license';
  const proc = child_process.spawn('powershell.exe', [`Remove-item alias:curl; curl -s -I -X POST ${url}`]);
  const { code } = await waitForSpawn(proc);
  assert.equal(code, 0);
  assert.deepEqual(fs.readFileSync(curlLog, 'utf8').trim().split('\n'), ['-s', '-I', '-X', 'POST', url]);
});

test('the trial check runs curl with an argument vector', async () => {
  const url = 'http://120.79.10.37/check-trial-encrypted';
  const id = '6affa588-c33d-19e4-8002-7f569160ea55';
  const proc = child_process.spawn('powershell.exe', [`Remove-item alias:curl; curl -s POST '${url}' -F 'machineID=${id}'`]);
  const { code } = await waitForSpawn(proc);
  assert.equal(code, 0);
  assert.deepEqual(fs.readFileSync(curlLog, 'utf8').trim().split('\n'), ['-s', '-X', 'POST', url, '-F', `machineID=${id}`]);
});

test('a trial check with anything but a machine ID is refused', async () => {
  const proc = child_process.spawn('powershell.exe', [`Remove-item alias:curl; curl -s POST 'http://x/' -F 'machineID=1'; touch ${canary}; '`]);
  const { err } = await waitForSpawn(proc);
  assert.equal(err.code, 'ENOENT');
  assert.equal(fs.existsSync(canary), false);
});

test('a clock check with shell syntax in the URL is refused', async () => {
  const proc = child_process.spawn('powershell.exe', [`Remove-item alias:curl; curl -s -I -X POST https://x/'; touch ${canary}; '`]);
  const { err } = await waitForSpawn(proc);
  assert.equal(err.code, 'ENOENT');
  assert.equal(fs.existsSync(canary), false);
});

test('unknown PowerShell commands fail and never reach a shell', async () => {
  const script = `curl -s GET 'https://x/'; touch ${canary}`;
  const spawned = await waitForSpawn(child_process.spawn('powershell.exe', ['-NoProfile', '-Command', script]));
  assert.equal(spawned.err.code, 'ENOENT');

  const viaExec = await new Promise((resolve) => child_process.exec(`powershell.exe -Command "${script}"`, (err) => resolve(err)));
  assert.equal(viaExec.code, 'ENOENT');

  assert.throws(() => child_process.execSync(`powershell -Command "${script}"`), { code: 'ENOENT' });
  assert.throws(() => child_process.execFileSync('C:\\Windows\\powershell.exe', [script]), { code: 'ENOENT' });

  const viaShellOption = await new Promise((resolve) => child_process.exec(`touch ${canary}`, { shell: 'powershell.exe' }, (err) => resolve(err)));
  assert.equal(viaShellOption.code, 'ENOENT');

  assert.equal(fs.existsSync(canary), false);
});

test('registry machine-id queries get the mock answer', async () => {
  const out = child_process.execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid');
  assert.match(String(out), /MachineGuid\s+REG_SZ\s+[0-9a-f-]{36}/);
});

test('ordinary commands are untouched', () => {
  assert.equal(String(child_process.execSync('echo ok')).trim(), 'ok');
  assert.equal(String(child_process.execFileSync('echo', ['ok'])).trim(), 'ok');
});

test('the Windows hosts path reads the real /etc/hosts', () => {
  assert.equal(fs.readFileSync('C:/Windows/System32/drivers/etc/hosts', 'utf8'), fs.readFileSync('/etc/hosts', 'utf8'));
  assert.equal(fs.readFileSync('C:\\Windows\\System32\\drivers\\etc\\hosts', 'utf8'), fs.readFileSync('/etc/hosts', 'utf8'));
});

test('user files whose paths mention hosts or drivers are real files', () => {
  const dir = path.join(scratch, 'Pictures', 'Drivers');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ghosts.json');
  fs.writeFileSync(file, '{"saved":true}');
  assert.equal(fs.readFileSync(file, 'utf8'), '{"saved":true}');
  assert.equal(fs.statSync(file).size, 14);
  assert.equal(fs.existsSync(path.join(dir, 'missing-hosts.png')), false);
});

test('a file Eagle tamper-checks is read as it is on disk', () => {
  const runJs = path.join(scratch, 'run.js');
  fs.writeFileSync(runJs, 'local copy');
  assert.equal(fs.readFileSync(runJs, 'utf8'), 'local copy');
});

test("Eagle's trial and licence state files are never faked", () => {
  const ldb = path.join(scratch, 'ipv4_data_1.ldb');
  const cert = path.join(scratch, 'Certifications');
  assert.equal(fs.existsSync(ldb), false);
  assert.equal(fs.existsSync(cert), false);
  assert.throws(() => fs.readFileSync(cert), { code: 'ENOENT' });
  fs.writeFileSync(cert, 'encrypted state');
  assert.equal(fs.readFileSync(cert, 'utf8'), 'encrypted state');
});

test('Windows DLL presence checks are faked by suffix only', () => {
  assert.equal(fs.existsSync('C:\\Windows\\System32\\vcruntime140.dll'), true);
  assert.equal(fs.existsSync(path.join(scratch, 'notes.dll.txt')), false);
});

test('shortcut URLs name an action and nothing else', () => {
  const { actionFromArgv } = require('../patches/sway-shortcuts');
  assert.equal(actionFromArgv(['eagle', 'eagle://shortcut/global.capture.area']), 'global.capture.area');
  assert.equal(actionFromArgv(['eagle', 'eagle://shortcut/global.show.eagle/']), 'global.show.eagle');
  assert.equal(actionFromArgv(['eagle', 'eagle://shortcut/../../etc']), null);
  assert.equal(actionFromArgv(['eagle', 'eagle://folder/ABC']), null);
  assert.equal(actionFromArgv(['eagle']), null);
});
