const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { inspect, stripVTControlCharacters } = require('util');
const { printWarning } = require('./warnings');

function compact(message, limit = 160) {
  const line = stripVTControlCharacters(String(message)).split(/\r?\n/)[0].trim();
  return line.length > limit ? line.slice(0, limit - 1) + '…' : line;
}

function describe(message) {
  const lines = String(message).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return {
    title: lines.find(line => line.startsWith('Capture failed')),
    page: lines.find(line => line.startsWith('Page URL: ')),
    hook: lines.find(line => line.startsWith('Hook: ')),
    reason: lines.find(line => !/^(?:Capture failed|(?:Final page|Page) URL:|Hook:)/.test(line)) || 'Capture failed'
  };
}

function captureErrorDetails(error) {
  return inspect(error, { depth: null, maxStringLength: null, colors: false });
}

function createCaptureDiagnostics(root, command, output = printWarning) {
  const logPath = path.join(root, '.reg', 'logs', `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}.log`);
  let created = false;
  let unavailable = false;
  let announced = false;
  const write = (level, details) => {
    if (unavailable) return false;
    try {
      if (!created) {
        fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(logPath, `Eaglediff ${command}\n`, { flag: 'wx', mode: 0o600 });
        created = true;
      }
      fs.appendFileSync(logPath, `\n[${new Date().toISOString()}] ${level}\n${stripVTControlCharacters(String(details))}\n`);
      return true;
    } catch (error) {
      unavailable = true;
      output(`Warning: Could not write capture log: ${error.message}. Showing full diagnostics.`);
      return false;
    }
  };
  const announce = () => {
    if (!announced) { output(`Details: ${logPath}`); announced = true; }
  };
  return {
    deferred({ event }) {
      const full = `Retry deferred until the end of the run.\nPage URL: ${event.url}\n${event.details || event.message}`;
      if (!write('DEFERRED', full)) { output(full); return; }
      output(`Warning: ${event.url} — ${event.scenarioLabel} @ ${event.viewportLabel}: retry deferred until the end of the run.`);
      announce();
    },
    warning(code, message, context = {}) {
      const saved = write('WARNING ' + code, `${context.url ? `Page URL: ${context.url}\n` : ''}${message}`);
      const body = String(message).replace(/^Warning:\s*/, '');
      const summary = context.url ? body.replace(/\s+Page(?: URL)?:\s+https?:\/\/\S+[\s\S]*$/, '') : body;
      output(saved ? `Warning: ${context.url ? context.url + ' — ' : ''}${compact(summary)}` : message);
      if (saved) announce();
    },
    retry(event) {
      const { scenarioLabel, viewportLabel, url, attempt, retries, factor, message, details } = event;
      const full = `Temporary capture error on ${scenarioLabel} @ ${viewportLabel}; retrying ${attempt}/${retries}\nPage URL: ${url}\n${details || message}\nReadiness timeout multiplier: ${factor}`;
      if (!write('RETRY', full)) { output(full); return; }
      const { hook, reason } = describe(message);
      const cause = hook ? compact(hook.replace(/^Hook: hooks\//, '').replace(/^Hook: /, ''), 80) + ' failed' : compact(reason, 70);
      output(`Warning: ${url} — ${scenarioLabel} @ ${viewportLabel}: ${cause}; retrying ${attempt}/${retries}${factor > 1 ? ` (timeouts ${factor}x)` : ''}.`);
      announce();
    },
    failure(error) {
      if (!/^Capture failed/.test(error.message)) return;
      if (!write('ERROR', captureErrorDetails(error))) return;
      const { title, page, hook, reason } = describe(error.message);
      Object.defineProperty(error, 'displayMessage', {
        value: [title, page, `${hook ? compact(hook, 100) + ': ' : ''}${compact(reason)}`, `Details: ${logPath}`].filter(Boolean).join('\n'),
        configurable: true
      });
    }
  };
}

module.exports = { createCaptureDiagnostics, captureErrorDetails };
