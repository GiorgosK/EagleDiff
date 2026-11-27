#!/usr/bin/env node
// Print a GitHub Actions error annotation for each failed test in a TAP file
// written by `node --test --test-reporter=tap`. Annotations are visible on
// the run page and through the public API, without opening the job log.
//
//   node .github/annotate-test-failures.js test-results.tap
const fs = require('fs');

const lines = fs.readFileSync(process.argv[2] || 'test-results.tap', 'utf8').split('\n');
const escape = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
let count = 0;
for (let index = 0; index < lines.length; index += 1) {
  const failed = lines[index].match(/^(\s*)not ok \d+ - (.*)$/);
  if (!failed) continue;
  // Subtests that only fail because a child failed carry no new information.
  const block = [];
  for (let next = index + 1; next < lines.length && !/^\s*(not )?ok \d+ /.test(lines[next]); next += 1) block.push(lines[next]);
  const text = block.join('\n');
  if (/failureType: 'subtestsFailed'/.test(text)) continue;
  const location = text.match(/location: '([^']+?):(\d+):\d+'/);
  const error = text.match(/error: \|-?\n([\s\S]*?)\n\s+code:/) || text.match(/error: '([^']*)'/);
  const file = location ? location[1].replace(`${process.cwd()}/`, '') : '';
  const message = (error ? error[1] : 'Test failed').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 12).join('\n');
  const where = file ? ` file=${file},line=${location[2]}` : '';
  console.log(`::error${where},title=${escape(failed[2].trim())}::${escape(message)}`);
  count += 1;
}
console.log(`${count} failed test(s) annotated.`);
