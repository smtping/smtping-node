'use strict';
// Offline smoke test: loads both entry points and checks helpers. Run: npm test
const assert = require('assert');
const cjs = require('./index.cjs');

assert.strictEqual(cjs.band('valid'), 'safe');
assert.strictEqual(cjs.band('spamtrap'), 'avoid');
assert.strictEqual(cjs.band('catch_all'), 'judgement');
assert.strictEqual(cjs.band('no_reply'), 'avoid');

// The band of the API wins; the status is only the fallback.
const bands = async () => {
  const answer = (body) => {
    const c = new cjs.Smtping('k');
    c.request = async () => body;
    return c;
  };
  const one = async (band) => (await answer({ email: 'a@b.co', status: 'valid', band }).verify('a@b.co')).band;
  assert.strictEqual(await one('judgement'), 'judgement');
  assert.strictEqual(await one(undefined), 'safe');
  assert.strictEqual(await one('other'), 'safe');
  const rows = await answer([{ status: 'valid', band: 'judgement' }, { status: 'no_reply' }]).bulk.results('j');
  assert.deepStrictEqual(rows.map((r) => r.band), ['judgement', 'avoid']);
};
assert.ok(cjs.isEmail('a@b.co'));
assert.ok(!cjs.isEmail('nope'));
assert.throws(() => new cjs.Smtping({ apiKey: '' }), cjs.AuthenticationError);
assert.strictEqual(new cjs.Smtping('k').baseUrl, 'https://api.smtping.com/api/v1');

bands().then(() => import('./index.mjs')).then((esm) => {
  assert.strictEqual(typeof esm.default, 'function');
  assert.strictEqual(esm.Smtping, cjs.Smtping);
  console.log('ok');
});
