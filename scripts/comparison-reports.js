const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const categories = ['failedItems', 'newItems', 'deletedItems', 'passedItems'];
const generationPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

function validateResult(result) {
  const names = new Set();
  for (const category of categories) {
    if (!Array.isArray(result[category])) throw new Error(`Invalid comparison: ${category} must be an array.`);
    for (const name of result[category]) {
      if (typeof name !== 'string' || path.basename(name) !== name || name.includes('\\') || !name.endsWith('.png') || names.has(name)) {
        throw new Error('Invalid or duplicate screenshot name in comparison results.');
      }
      names.add(name);
    }
  }
  return result;
}

async function readOptional(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function loadStore(root) {
  const directory = path.join(root, '.reg/reports');
  const pointer = await readOptional(path.join(directory, 'latest.json'));
  if (!pointer) return null;
  if (!generationPattern.test(pointer.generation)) throw new Error('Invalid saved comparison report pointer.');
  const state = await readOptional(path.join(directory, pointer.generation, 'state.json'));
  if (!state || state.version !== 1 || !Array.isArray(state.items)) throw new Error('Invalid saved comparison report state.');
  validateResult(state.latestComparison);
  const names = new Set();
  for (const item of state.items) {
    validateResult(Object.fromEntries(categories.map(category => [category, category === item.status ? [item.fileName] : []])));
    if (!categories.includes(item.status) || !generationPattern.test(item.generation) || names.has(item.fileName)) {
      throw new Error('Invalid saved screenshot report entry.');
    }
    names.add(item.fileName);
  }
  return { directory, generation: pointer.generation, state };
}

async function legacyComparison(root) {
  const run = path.join(root, '.reg/run');
  const manifest = await readOptional(path.join(run, 'capture-manifest.json'));
  if (!manifest) return null;
  if (manifest.version !== 1 || typeof manifest.fullRun !== 'boolean' || !Array.isArray(manifest.fileNames)) {
    throw new Error('Invalid completed comparison manifest.');
  }
  const result = await readOptional(path.join(run, 'out.json'));
  if (!result) throw new Error('Completed comparison is missing its results.');
  return { result: validateResult(result), manifest, run };
}

async function readLastComparison(root) {
  const current = await legacyComparison(root);
  if (current) return current.result;
  const saved = await loadStore(root);
  if (saved) return saved.state.latestComparison;
  return null;
}

async function retainPreviousComparison(root, metadata = {}) {
  const saved = await loadStore(root);
  const legacy = await legacyComparison(root);
  if (!legacy) return;
  const stat = await fs.stat(path.join(legacy.run, 'out.json'));
  if (saved && Math.floor(stat.mtimeMs) <= Date.parse(saved.state.completedAt)) return;
  await saveComparison({ root, run: legacy.run, result: legacy.result,
    fullRun: legacy.manifest.fullRun, metadata, completedAt: stat.mtime.toISOString() });
}

async function saveComparison({ root, run, result, fullRun, metadata = {}, completedAt = new Date().toISOString() }) {
  validateResult(result);
  const directory = path.join(root, '.reg/reports');
  await fs.mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, '.update.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another report update is in progress. If no run is active, remove ${lockPath}.`, { cause: error });
    throw error;
  }
  const generation = randomUUID();
  const destination = path.join(directory, generation);
  const pointerTemp = path.join(directory, `.${generation}.json`);
  let published = false;
  try {
    const previous = await loadStore(root);
    const previousItems = new Map((previous?.state.items || []).map(item => [item.fileName, item]));
    const items = fullRun ? new Map() : new Map(previousItems);
    await fs.mkdir(destination);
    for (const status of categories) {
      for (const fileName of result[status]) {
        const details = metadata[fileName] || previousItems.get(fileName)?.details;
        const item = { fileName, status, generation, completedAt, ...(details ? { details } : {}) };
        for (const kind of ['actual', 'expected', 'diff']) {
          const source = path.join(run, kind, fileName);
          const required = kind === 'actual' ? status !== 'deletedItems' : kind === 'expected' && status !== 'newItems';
          try {
            await fs.mkdir(path.join(destination, kind), { recursive: true });
            await fs.copyFile(source, path.join(destination, kind, fileName));
            item[kind] = true;
          } catch (error) {
            if (error.code !== 'ENOENT' || required) throw error;
          }
        }
        items.set(fileName, item);
      }
    }
    const state = { version: 1, completedAt, latestComparison: Object.fromEntries(categories.map(key => [key, result[key]])), items: [...items.values()] };
    await fs.writeFile(path.join(destination, 'state.json'), JSON.stringify(state) + '\n');
    await fs.writeFile(path.join(destination, 'index.html'), renderAllReport(state));
    await fs.writeFile(pointerTemp, JSON.stringify({ generation }) + '\n');
    await fs.rename(pointerTemp, path.join(directory, 'latest.json'));
    published = true;
    // Keep only image generations still used by the latest result of each case.
    const retained = new Set([generation, ...state.items.map(item => item.generation)]);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && generationPattern.test(entry.name) && !retained.has(entry.name)) {
        await fs.rm(path.join(directory, entry.name), { recursive: true, force: true });
      }
    }
  } finally {
    try {
      if (!published) await fs.rm(destination, { recursive: true, force: true });
      await fs.rm(pointerTemp, { force: true });
    } finally {
      try { await lock.close(); }
      finally { await fs.unlink(lockPath); }
    }
  }
}

async function allReportPath(root) {
  let saved = await loadStore(root);
  if (!saved) {
    await retainPreviousComparison(root);
    saved = await loadStore(root);
  }
  if (!saved) throw new Error('No completed comparisons available. Run eaglediff test first.');
  return path.join(saved.directory, saved.generation, 'index.html');
}

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderAllReport(state) {
  const labels = { failedItems: 'Changed', newItems: 'New', deletedItems: 'Removed', passedItems: 'Passed' };
  const image = (item, kind) => `../${item.generation}/${kind}/${encodeURIComponent(item.fileName)}`;
  const cards = state.items.map(item => {
    const details = item.details || {};
    const title = details.label || details.url || item.fileName;
    const preview = item.actual ? 'actual' : 'expected';
    return `<article data-status="${item.status}"><header><span class="status ${item.status}">${labels[item.status]}</span><h2>${escape(title)}</h2><p>${escape(details.viewport || '')} ${escape(details.url || '')}</p><p>Test completed: <time datetime="${escape(item.completedAt)}">${escape(item.completedAt)}</time></p></header>
<a href="${image(item, preview)}"><img class="preview" loading="lazy" src="${image(item, preview)}" alt="${escape(title)}"></a>
<details><summary>Compare images</summary><div class="images">${['expected', 'actual', 'diff'].filter(kind => item[kind]).map(kind => `<figure><figcaption>${{ expected: 'Reference', actual: 'Latest capture', diff: 'Difference' }[kind]}</figcaption><a href="${image(item, kind)}"><img loading="lazy" src="${image(item, kind)}" alt="${kind}"></a></figure>`).join('')}</div></details></article>`;
  }).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eaglediff — All results</title>
<style>body{margin:0;background:#f3f5f8;color:#182331;font:16px system-ui}main{max-width:1500px;margin:auto;padding:24px}h1{margin-top:0}h2{font-size:18px;overflow-wrap:anywhere}p{overflow-wrap:anywhere}nav{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}button,summary{cursor:pointer}button{padding:8px 14px}#cases{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:18px}article{background:white;border:1px solid #ccd3dd;border-radius:8px;overflow:hidden}article header,details{padding:16px}article p{font-size:13px;color:#526173}.status{font-weight:bold}.passedItems{color:#16703b}.failedItems,.deletedItems{color:#b3261e}.newItems{color:#805900}.preview{width:100%;height:250px;object-fit:contain;object-position:top;background:#e8ebef}.images{display:flex;gap:12px;flex-wrap:wrap}figure{margin:12px 0;flex:1;min-width:140px}figure img{width:100%}[hidden]{display:none!important}</style>
<main><h1>All available test results</h1><p>Latest saved result for each screenshot. A filtered run updates only the pages it tested; other results come from earlier runs.</p><p>${state.items.length} screenshots.</p>
<nav aria-label="Filter results"><button data-filter="all">All (${state.items.length})</button>${categories.map(key => `<button data-filter="${key}">${labels[key]} (${state.items.filter(item => item.status === key).length})</button>`).join('')}</nav><section id="cases">${cards}</section></main>
<script>document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('article').forEach(card=>{card.hidden=button.dataset.filter!=='all'&&card.dataset.status!==button.dataset.filter;});}));document.querySelectorAll('time').forEach(time=>{time.textContent=new Date(time.dateTime).toLocaleString();});</script></html>`;
}

module.exports = { readLastComparison, retainPreviousComparison, saveComparison, allReportPath, loadStore };
