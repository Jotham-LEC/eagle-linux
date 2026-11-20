#!/usr/bin/env node
/**
 * Apply the Linux compatibility edits to a pristine Eagle app/ tree.
 *
 *   node pristine-patches.js APP_DIR
 *
 * The repository carries no copies of Ogdesign's files. Each edit below is an
 * exact-string replacement made against the files extracted from the pinned
 * installer, and the run fails unless every `find` occurs exactly once. A new
 * Eagle build that moves any of these lines therefore fails the build instead
 * of shipping a half-patched app. An edit whose `replace` text is already
 * present exactly once counts as applied, so re-running on a patched tree
 * (packaging/ensure-extracted-app.sh does) changes nothing.
 *
 * Eagle hashes five of its own files at startup and refuses to run if any
 * differs (run.jsc checks the first four, main.jsc checks run.jsc). Those files
 * are off limits here, and the run ends by confirming they still carry the
 * digests embedded in Eagle's bytecode. Nothing has to fake a hash at runtime.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TAMPER_CHECKED = {
  'run.js': 'f9a77da6177275249fb3ab3a9bc9e799',
  'run.jsc': 'c266a5ac70db0b53e9fa05384c6f5873',
  'app/app.bundle.js': '38cbbdf0801776761f36e149447cb1a7',
  'app/index.html': '666f230ec6266eb366f06f475939f3f6',
  'app/js/background.js': '4dded3b9f67eacee725adc09acb28542',
};

// Each `find`/`replace` is written with \n line endings and converted to the
// target file's own line endings before matching.
const PATCHES = [
  {
    file: 'app/js/directives/welcome-page.js',
    why: 'Linux has no illustrations of its own; show the Windows ones.',
    find: `        $scope.platform = process.platform;\n`,
    replace: `        $scope.platform = process.platform === 'linux' ? 'win32' : process.platform;\n`,
  },
  {
    file: 'app/js/utils/remainingFilenameLength.js',
    why: 'maxPathLength is left undefined on Linux, so every name length is NaN.',
    find: `    let maxPathLength;\n`,
    replace: `    let maxPathLength = 4096; // PATH_MAX on Linux\n`,
  },
  {
    file: 'app/js/lib/api/screen-capture.js',
    why: 'screen.getCursorDisplay can reject on Wayland; do not lose the capture over it.',
    find:
      `        const currentDisplay = await ipcRenderer.invoke('screen.getCursorDisplay');\n` +
      `        const isRetina = (currentDisplay.scaleFactor == 2);\n`,
    replace:
      `        const currentDisplay = await ipcRenderer.invoke('screen.getCursorDisplay').catch(() => null);\n` +
      `        const isRetina = (currentDisplay?.scaleFactor == 2);\n`,
  },
  {
    file: 'app/js/lib/api/screen-capture.js',
    why: 'Windows shells out to NiuniuCapture.exe; Linux captures through patches/linux-screenshot.js.',
    find: `            switch (mode) {\n`,
    replace:
      `            if (process.platform === 'linux') {\n` +
      `                await require(require('path').join(String(appRoot), '..', 'patches', 'linux-screenshot.js')).capture({ mode, tempPath });\n` +
      `            } else switch (mode) {\n`,
  },
  {
    file: 'my_modules/get-drive-type/index.js',
    why: 'There is no Linux addon; report "unknow" as the Windows code path does for unknown drives.',
    find: `    let result = addon.fsType(path);\n`,
    replace: `    let result = addon ? addon.fsType(path) : null;\n`,
  },
  {
    file: 'my_modules/is-network-drive/main.js',
    why: 'Every platform but macOS loads the Windows-only addon at require time.',
    find: `if (process.platform !== 'darwin') {\n`,
    replace: `if (process.platform === 'win32') {\n`,
  },
  {
    file: 'my_modules/is-network-drive/main.js',
    why: 'Linux throws, which the catch below turns into "not a network drive" anyway.',
    find: `            throw Error('not support linux yet')\n`,
    replace: `            return false; // eagle-linux: no network-drive detection\n`,
  },
  {
    file: 'my_modules/native-mouse/index.js',
    why: 'Every platform but macOS loads the Windows-only addon; Linux gets no native mouse hooks.',
    find: `else {\n    Mouse = bindings('native-mouse-win').Mouse;\n}\n`,
    replace:
      `else if (process.platform === 'win32') {\n    Mouse = bindings('native-mouse-win').Mouse;\n}\n` +
      `else {\n    Mouse = class { ref() {} unref() {} destroy() {} };\n}\n`,
  },
  {
    file: 'package.json',
    why: 'Tray and window icons: Linux reads the PNG, not the Windows .ico.',
    find: `    "win": {\n      "iconUrl": "./assets/icon.ico"\n    }\n`,
    replace:
      `    "win": {\n      "iconUrl": "./assets/icon.ico"\n    },\n` +
      `    "linux": {\n      "iconUrl": "./assets/icon.png"\n    }\n`,
  },
];

function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function countOccurrences(haystack, needle) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

function main(appDir) {
  const errors = [];

  for (const p of PATCHES) {
    if (Object.prototype.hasOwnProperty.call(TAMPER_CHECKED, p.file)) {
      errors.push(`${p.file}: Eagle's tamper check hashes this file; it must stay pristine`);
      continue;
    }
    const target = path.join(appDir, p.file);
    const text = fs.readFileSync(target, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const find = p.find.replace(/\n/g, eol);
    const replace = p.replace.replace(/\n/g, eol);
    if (countOccurrences(text, replace) === 1) {
      console.log(`already patched ${p.file}: ${p.why}`);
      continue;
    }
    const n = countOccurrences(text, find);
    if (n !== 1) {
      errors.push(`${p.file}: expected exactly 1 match, found ${n}, for:\n${p.find}`);
      continue;
    }
    fs.writeFileSync(target, text.replace(find, () => replace));
    console.log(`patched ${p.file}: ${p.why}`);
  }

  for (const [rel, want] of Object.entries(TAMPER_CHECKED)) {
    const got = md5(fs.readFileSync(path.join(appDir, rel)));
    if (got !== want) errors.push(`${rel}: md5 ${got}, Eagle expects ${want}`);
  }

  if (errors.length) {
    for (const e of errors) console.error(`pristine-patches: ${e}`);
    process.exit(1);
  }
  console.log(`pristine-patches: ${PATCHES.length} edits in place; tamper-checked files intact`);
}

if (process.argv.length !== 3) {
  console.error('usage: node pristine-patches.js APP_DIR');
  process.exit(2);
}
main(process.argv[2]);
