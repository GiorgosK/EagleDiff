const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveChromePath } = require('../scripts/run');

const only = path => candidate => candidate === path;

test('finds Chrome in the standard macOS and Windows install locations', () => {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.equal(resolveChromePath({ platform: 'darwin', env: { HOME: '/Users/me' }, exists: only(mac) }), mac);
  const userMac = '/Users/me/Applications/Chromium.app/Contents/MacOS/Chromium';
  assert.equal(resolveChromePath({ platform: 'darwin', env: { HOME: '/Users/me' }, exists: only(userMac) }), userMac);

  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' };
  const windows = 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
  assert.equal(resolveChromePath({ platform: 'win32', env, exists: only(windows) }), windows);
});

test('CHROME_BIN and PUPPETEER_EXECUTABLE_PATH take precedence; a missing browser explains what to set', () => {
  const exists = () => true;
  assert.equal(resolveChromePath({ platform: 'darwin', env: { CHROME_BIN: '/opt/chrome' }, exists }), '/opt/chrome');
  assert.equal(resolveChromePath({ platform: 'win32', env: { CHROME_BIN: 'D:\\chrome.exe', PUPPETEER_EXECUTABLE_PATH: 'E:\\pptr.exe' }, exists }), 'E:\\pptr.exe');
  assert.throws(() => resolveChromePath({ platform: 'win32', env: {}, exists: () => false }),
    /No Chrome\/Chromium executable found\. Install Chrome or Chromium, or set CHROME_BIN/);
});
