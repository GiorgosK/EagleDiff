const assert = require('node:assert/strict');
const { test } = require('node:test');
const wait = require('../scripts/hooks/wait-for-network-idle');

test('network idle tolerates only timeouts and propagates browser failures', async () => {
  const context = { scenario: {}, config: {} };
  const timeout = Object.assign(new Error('Busy network'), { name: 'TimeoutError' });
  await wait({ waitForNetworkIdle: async () => { throw timeout; } }, context);
  const disconnected = new Error('Connection closed.');
  await assert.rejects(wait({ waitForNetworkIdle: async () => { throw disconnected; } }, context), error => error === disconnected);
});
