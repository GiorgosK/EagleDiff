const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

module.exports = async function cliFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglediff-cli-'));
  const pages = { '/one': '<h1>One</h1>', '/two': '<h1>Two</h1>' };
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('Content-Type', 'text/html');
    response.end(pages[request.url] || '<h1>Unknown</h1>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const config = {
    version: require('../../config-default.json').version,
    referenceBaseURL: baseURL, testBaseURL: baseURL,
    core: { workers: 1, thresholdRate: 0 },
    defaults: { delay: 0, fullPage: false, waitUntil: 'load' },
    viewports: [{ label: 'small', width: 100, height: 100 }],
    scenarios: [{ url: '/one' }, { url: '/two' }]
  };
  const save = () => fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
  const run = async (args, expectedExit = 0) => {
    let result;
    try {
      result = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../../bin/eaglediff.js'), '--dir', directory, ...args], {
        timeout: 30000,
        env: { ...process.env, INIT_CWD: '', EAGLEDIFF_DIR: '', EAGLEDIFF_CONFIG: '', GLOBAL_EAGLEDIFF_CONFIG: '', npm_config_config: '', npm_config_workers: '' }
      });
      result.code = 0;
    } catch (error) { result = error; }
    assert.equal(result.code, expectedExit, `${result.stdout || ''}\n${result.stderr || ''}`);
    return result;
  };
  const files = () => fs.readdir(path.join(directory, '.reg/reference'));
  await save();
  return { directory, config, save, run, files, pages, requests, baseURL };
};
