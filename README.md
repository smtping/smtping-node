# SMTPing for Node.js

Official JavaScript and TypeScript SDK and command-line tool for the [SMTPing](https://smtping.com) email verification API.

- Zero dependencies, Node 18+ (uses native `fetch`)
- ESM and CommonJS, TypeScript types included
- Automatic retries on rate limits (429) and server errors (5xx)
- Bulk jobs up to 100,000 addresses, with polling built in
- `smtping` CLI to verify addresses or a CSV file from the terminal

## Install

```bash
npm install smtping
```

Create an API key in the [SMTPing dashboard](https://app.smtping.com). Pass it to the client or set `SMTPING_API_KEY`.

## Verify one address

```js
import Smtping from 'smtping';

const smtping = new Smtping({ apiKey: process.env.SMTPING_API_KEY });

const r = await smtping.verify('jane@example.com');
console.log(r.status, r.band); // "valid" "safe"
```

CommonJS works too:

```js
const { Smtping } = require('smtping');
```

Every result carries a `band` field for simple routing:

| band | statuses | action |
| --- | --- | --- |
| `safe` | valid, alias | send |
| `avoid` | invalid, spamtrap, disposable, blacklisted, complainer, spambot, inbox_full | remove |
| `judgement` | catch_all, unknown, role and others | your call |

## Verify a list

Small lists (up to a few hundred) with parallel single calls:

```js
const rows = await smtping.verifyMany(['a@example.com', 'b@example.com'], { concurrency: 5 });
```

Large lists as one bulk job:

```js
const job = await smtping.bulk.create(emails);         // { jobId, status }
const rows = await smtping.bulk.wait(job.jobId, {
  onProgress: (s) => console.log(s.processedEmails),
});

// or in one call
const rows2 = await smtping.bulk.run(emails);
```

Check a job later with `smtping.bulk.get(jobId)` and `smtping.bulk.results(jobId)`.

## Threat list checks

```js
await smtping.check('spamtrap', 'jane@example.com');
// also: 'disposable', 'spambot', 'complainer'
```

## Credits

```js
const { remaining, plan } = await smtping.credits();
```

## Errors

```js
import { AuthenticationError, InsufficientCreditsError, RateLimitError } from 'smtping';

try {
  await smtping.verify('jane@example.com');
} catch (e) {
  if (e instanceof InsufficientCreditsError) { /* top up */ }
  console.error(e.status, e.message);
}
```

Classes: `SmtpingError` (base, with `status` and `body`), `AuthenticationError`, `InsufficientCreditsError`, `RateLimitError`, `ValidationError`, `JobFailedError`, `TimeoutError`.

## Options

| option | default | |
| --- | --- | --- |
| `apiKey` | `SMTPING_API_KEY` | required |
| `baseUrl` | `https://api.smtping.com/api/v1` | |
| `timeout` | `60000` | ms per request |
| `maxRetries` | `3` | network errors, 429, 5xx |

## CLI

```bash
npx smtping login sk_live_xxx
npx smtping verify jane@example.com john@example.org
npx smtping bulk contacts.csv --wait --out results.csv
npx smtping status <job-id>
npx smtping results <job-id> --out results.csv
npx smtping check disposable jane@example.com
npx smtping credits
```

Install globally with `npm install -g smtping` to drop the `npx`. Add `--json` to any command for machine-readable output. The key is read from `--key`, then `SMTPING_API_KEY`, then the file saved by `smtping login` (`~/.config/smtping/config.json`).

## Links

- [API documentation](https://smtping.com/docs)
- [Pricing](https://smtping.com/pricing)
- Support: support@smtping.com

MIT License
