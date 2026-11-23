#!/usr/bin/env node
// Serve the built benchmark site. With VISUAL_BUGS=1, add the known bugs from
// visual-bugs/ (see ../bugs.json); without it, serve the clean site unchanged.
//
//   node serve.js <site folder>             http://localhost:4173
//   VISUAL_BUGS=1 node serve.js <site folder>
const fs = require('fs');
const http = require('http');
const path = require('path');

const site = process.argv[2];
if (!site) {
  console.error('Usage: [VISUAL_BUGS=1] node serve.js <site folder>');
  process.exit(2);
}
const root = path.resolve(site, 'build');
const port = Number(process.env.PORT || 4173);
const bugs = process.env.VISUAL_BUGS === '1' ? require('./visual-bugs/bugs') : null;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.gif': 'image/gif', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.woff2': 'font/woff2' };

function resolve(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  for (const candidate of [clean, `${clean}.html`, path.join(clean, 'index.html')]) {
    const file = path.join(root, candidate);
    if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

http.createServer((request, response) => {
  const { pathname } = new URL(request.url, 'http://localhost');
  const file = resolve(pathname);
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain' });
    return response.end('Not found');
  }
  const type = types[path.extname(file)] || 'application/octet-stream';
  let body = fs.readFileSync(file);
  if (bugs && type.startsWith('text/html')) body = bugs.page(pathname, body.toString('utf8'));
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  response.end(body);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${bugs ? ' with the visual bugs' : ''}`));
