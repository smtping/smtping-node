'use strict';
// Offline smoke test: loads both entry points and checks helpers. Run: npm test
const assert = require('assert');
const cjs = require('./index.cjs');

assert.strictEqual(cjs.band('valid'), 'safe');
assert.strictEqual(cjs.band('spamtrap'), 'avoid');
assert.strictEqual(cjs.band('catch_all'), 'judgement');
assert.ok(cjs.isEmail('a@b.co'));
assert.ok(!cjs.isEmail('nope'));
assert.throws(() => new cjs.Smtping({ apiKey: '' }), cjs.AuthenticationError);
assert.strictEqual(new cjs.Smtping('k').baseUrl, 'https://api.smtping.com/api/v1');

import('./index.mjs').then((esm) => {
  assert.strictEqual(typeof esm.default, 'function');
  assert.strictEqual(esm.Smtping, cjs.Smtping);
  console.log('ok');
});
