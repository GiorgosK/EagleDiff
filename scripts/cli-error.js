// Format command failures only at the CLI boundary; keep stored errors intact.
function formatError(error, { color = false, width = 100 } = {}) {
  const heading = color ? '\x1b[31mERROR:\x1b[0m' : 'ERROR:';
  const limit = Math.max(40, Math.min(100, width || 100));
  const message = String(error?.message ?? error);
  // Puppeteer's encoded evaluation locations are stack frames, not the cause.
  const lines = message.split(/\r?\n/)
    .filter(line => !/^\s*(?:pptr:evaluate;|async Promise\.all \(index \d+\))/.test(line))
    .flatMap(line => {
      const result = [];
      let remaining = line.trim();
      while (remaining.length > limit) {
        const space = remaining.lastIndexOf(' ', limit);
        // Keep resource URLs intact so they can still be opened or copied.
        if (space < 1) break;
        result.push(remaining.slice(0, space));
        remaining = remaining.slice(space + 1).trimStart();
      }
      result.push(remaining);
      return result;
    });
  return `\n${heading}\n${lines.map(line => line ? `  ${line}` : '').join('\n')}\n\n`;
}

function reportError(error) {
  process.stderr.write(formatError(error, {
    color: !!process.stderr.isTTY && !Object.hasOwn(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb',
    width: process.stderr.columns
  }));
}

module.exports = reportError;
module.exports.formatError = formatError;
