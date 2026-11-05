const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const escape = value => String(value ?? '').replace(/[&<>"']/g,
  character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function readManifest(root) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(root, '.reg/reference-report/captures.json'), 'utf8'));
    if (manifest.version !== 1 || !manifest.metadata || typeof manifest.metadata !== 'object') throw new Error('Invalid reference gallery metadata.');
    return manifest;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeAtomic(filename, content) {
  const temporary = filename + '.' + randomUUID();
  try {
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function referenceReportPath(root, metadata) {
  const referenceDirectory = path.join(root, '.reg/reference');
  let names;
  try { names = (await fs.readdir(referenceDirectory, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.png')).map(entry => entry.name).sort(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
  if (!names.length) throw new Error('No reference captures found. Run eaglediff reference first.');
  const saved = await readManifest(root);
  const details = { ...saved?.metadata, ...metadata };
  const captures = await Promise.all(names.map(async name => ({ name, details: details[name] || {}, modified: (await fs.stat(path.join(referenceDirectory, name))).mtime.toISOString() })));
  const directory = path.join(root, '.reg/reference-report');
  await fs.mkdir(directory, { recursive: true });
  const report = path.join(directory, 'index.html');
  const cards = captures.map(capture => {
    const title = capture.details.label || capture.details.url || capture.name;
    const image = '../reference/' + encodeURIComponent(capture.name);
    return `<article><h2>${escape(title)}</h2><p>${escape(capture.details.viewport || '')}</p><p>${escape(capture.details.url || '')}</p><p>Saved: <time datetime="${capture.modified}">${capture.modified}</time></p><a href="${image}"><img loading="lazy" src="${image}" alt="${escape(title)}"></a></article>`;
  }).join('\n');
  await writeAtomic(report, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eaglediff — Reference captures</title>
<style>body{margin:0;background:#f3f5f8;color:#182331;font:16px system-ui}main{max-width:1500px;margin:auto;padding:24px}#captures{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:18px}article{background:white;border:1px solid #ccd3dd;border-radius:8px;padding:16px}h2{font-size:18px}p,h2{overflow-wrap:anywhere}article p{font-size:13px;color:#526173}img{width:100%;height:300px;object-fit:contain;object-position:top}</style>
<main><h1>Reference captures</h1><p>${captures.length} saved screenshots. Open an image to inspect it at full size. These captures have no pass or fail result.</p><section id="captures">${cards}</section></main>
<script>document.querySelectorAll('time').forEach(time=>{time.textContent=new Date(time.dateTime).toLocaleString();});</script></html>`);
  if (metadata) {
    await writeAtomic(path.join(directory, 'captures.json'), JSON.stringify({ version: 1, completedAt: new Date().toISOString(), metadata: Object.fromEntries(names.filter(name => details[name]).map(name => [name, details[name]])) }) + '\n');
  }
  return report;
}

module.exports = { referenceReportPath, readManifest };
