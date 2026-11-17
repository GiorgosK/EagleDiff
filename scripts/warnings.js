function printWarning(message) {
  const color = !!process.stderr.isTTY && !Object.hasOwn(process.env, 'NO_COLOR') && process.env.TERM !== 'dumb';
  const formatted = color ? String(message).replace(/^Warning:/, '\x1b[38;5;208mWarning:\x1b[0m') : message;
  console.warn(`[eaglediff] ${formatted}`);
}

function createWarningReporter(output = printWarning) {
  const seen = new Set();
  return (code, message, context) => {
    if (seen.has(code)) return;
    seen.add(code);
    output(message, code, context);
  };
}

module.exports = { createWarningReporter, printWarning };
