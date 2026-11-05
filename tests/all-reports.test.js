const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const puppeteer = require('puppeteer-core');
const fixture = require('./helpers/cli-fixture');
const { buildBrowserLaunchOptions, getScreenshotFileName } = require('../scripts/run');
const { loadStore, saveComparison, allReportPath } = require('../scripts/comparison-reports');
const { getReportPath } = require('../scripts/report');

const result = names => ({ failedItems: [], newItems: [], deletedItems: [], passedItems: names });

test('all report retains untouched results after a filtered pass and renders valid local images and escaped labels', async t => {
  const f = await fixture(t);
  f.config.scenarios[0].label = '<script>window.pwned=true</script>'; await f.save();
  await f.run(['reference']);
  f.pages['/one'] = '<style>body{background:red}</style>';
  await f.run(['test'], 1);
  const before = await loadStore(f.directory);
  const secondName = getScreenshotFileName(f.config.scenarios[1], f.config.viewports[0]);
  const oldSecond = before.state.items.find(item => item.fileName === secondName);
  f.pages['/one'] = '<h1>One</h1>';
  await f.run(['test', '--filter=/one']);
  const after = await loadStore(f.directory);
  assert.equal(after.state.items.length, 2);
  assert(after.state.items.every(item => item.status === 'passedItems'));
  assert.deepEqual(after.state.items.find(item => item.fileName === secondName), oldSecond);
  const latestPath = await getReportPath(f.directory);
  const latest = await fs.readFile(latestPath);
  const manifestPath = path.join(f.directory, '.reg/run/capture-manifest.json');
  const manifest = await fs.readFile(manifestPath);
  const requestCount = f.requests.length;
  const report = await getReportPath(f.directory, true);
  assert.notEqual(report, latestPath);
  const browser = await puppeteer.launch(buildBrowserLaunchOptions());
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(pathToFileURL(report).href);
  assert.equal(await page.$$eval('article', cards => cards.length), 2);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.$eval('h2', title => title.textContent), f.config.scenarios[0].label);
  await page.$$eval('img', images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode(); })));
  await page.click('[data-filter="failedItems"]');
  assert.equal(await page.$$eval('article:not([hidden])', cards => cards.length), 0);
  await page.click('[data-filter="all"]');
  assert.equal(await page.$$eval('article:not([hidden])', cards => cards.length), 2);
  assert.equal(f.requests.length, requestCount, 'opening saved results must not recapture pages');
  assert.deepEqual(await fs.readFile(latestPath), latest);
  assert.deepEqual(await fs.readFile(manifestPath), manifest, 'all report must not alter approval selection');

  if (process.platform !== 'win32') {
    const openerDirectory = path.join(f.directory, 'opener'); await fs.mkdir(openerDirectory);
    const log = path.join(f.directory, 'opened.txt');
    await fs.writeFile(path.join(openerDirectory, process.platform === 'darwin' ? 'open' : 'xdg-open'),
      '#!/bin/sh\nprintf "%s" "$1" > "$EAGLEDIFF_OPEN_LOG"\n', { mode: 0o755 });
    for (const [flag, target] of [['--all', report]]) {
      await fs.rm(log, { force: true });
      await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../bin/eaglediff.js'), '--dir', f.directory, 'report', flag], {
        env: { ...process.env, INIT_CWD: '', EAGLEDIFF_DIR: '', PATH: openerDirectory + path.delimiter + process.env.PATH, EAGLEDIFF_OPEN_LOG: log }
      });
      let opened;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { opened = await fs.readFile(log, 'utf8'); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
      }
      assert.equal(opened, target, `report ${flag} forwards the flag and opens the requested report`);
    }
  }
});

test('report snapshots publish atomically, prune obsolete generations, and preserve the prior report on invalid input or missing images', async t => {
  const f = await fixture(t);
  await f.run(['reference']);
  const name = (await f.files())[0];
  const png = await fs.readFile(path.join(f.directory, '.reg/reference', name));
  const run = path.join(f.directory, 'manual-run');
  for (const kind of ['expected', 'actual']) {
    await fs.mkdir(path.join(run, kind), { recursive: true }); await fs.writeFile(path.join(run, kind, name), png);
  }
  const save = comparison => saveComparison({ root: f.directory, run, result: comparison, fullRun: true });
  await save(result([name]));
  const old = await loadStore(f.directory);
  const pointerPath = path.join(old.directory, 'latest.json');
  const pointer = await fs.readFile(pointerPath);
  await assert.rejects(save(result(['../outside.png'])), /Invalid/);
  await fs.unlink(path.join(run, 'actual', name));
  await assert.rejects(save(result([name])), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(pointerPath), pointer);
  await fs.access(await allReportPath(f.directory));
  await assert.rejects(fs.access(path.join(old.directory, '.update.lock')), { code: 'ENOENT' });
  await fs.writeFile(path.join(run, 'actual', name), png);
  const lock = path.join(old.directory, '.update.lock'); await fs.writeFile(lock, '');
  await assert.rejects(save(result([name])), /Another report update/);
  await fs.access(await allReportPath(f.directory));
  assert.deepEqual(await fs.readFile(pointerPath), pointer);
  await fs.unlink(lock);
  await save(result([name]));
  const current = await loadStore(f.directory);
  assert.notEqual(current.generation, old.generation);
  await assert.rejects(fs.access(path.join(old.directory, old.generation)), { code: 'ENOENT' });
  await fs.access(path.join(current.directory, current.generation, 'actual', name));
});

test('legacy completed reports can seed the all-results view without changing their report or approval manifest', async t => {
  const f = await fixture(t);
  await assert.rejects(allReportPath(f.directory), /No completed comparisons/);
  await f.run(['reference']); await f.run(['test']);
  await fs.rm(path.join(f.directory, '.reg/reports'), { recursive: true });
  const manifestPath = path.join(f.directory, '.reg/run/capture-manifest.json');
  const manifest = await fs.readFile(manifestPath);
  const latest = await fs.readFile(await getReportPath(f.directory));
  await fs.access(await allReportPath(f.directory));
  assert.equal((await loadStore(f.directory)).state.items.length, 2);
  assert.deepEqual(await fs.readFile(manifestPath), manifest);
  assert.deepEqual(await fs.readFile(await getReportPath(f.directory)), latest);
  await f.run(['test', '--filter=/one']);
  assert.equal((await loadStore(f.directory)).state.items.length, 2);
});
