function createWarningReporter(output = message => console.warn(`[reg-suit] ${message}`)) {
  const seen = new Set();
  return (code, message) => {
    if (seen.has(code)) return;
    seen.add(code);
    output(message, code);
  };
}

module.exports = { createWarningReporter };
