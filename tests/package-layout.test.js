const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveRegSuitBin } = require('../scripts/run');

// npm installs a package's dependencies next to it (node_modules/eaglediff and
// node_modules/reg-suit side by side); pnpm and checkouts nest them inside.
test('reg-suit is found when npm installs it next to Eaglediff', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-layout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const modules = path.join(root, 'node_modules');
  const eaglediff = path.join(modules, 'eaglediff');
  const regSuit = path.join(modules, 'reg-suit');
  await fs.mkdir(eaglediff, { recursive: true });
  await fs.mkdir(path.join(regSuit, 'lib'), { recursive: true });
  await fs.writeFile(path.join(eaglediff, 'package.json'), '{"name":"eaglediff"}');
  await fs.writeFile(path.join(regSuit, 'package.json'), '{"name":"reg-suit","main":"lib/cli.js"}');
  await fs.writeFile(path.join(regSuit, 'lib', 'cli.js'), '');
  assert.equal(await fs.realpath(resolveRegSuitBin(eaglediff)), await fs.realpath(path.join(regSuit, 'lib', 'cli.js')));
});

test('reg-suit is found in this checkout', () => {
  assert.match(resolveRegSuitBin(), /reg-suit[\\/]lib[\\/]cli\.js$/);
});
