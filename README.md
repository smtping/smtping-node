# SMTPing for Node.js

Official JavaScript and TypeScript SDK and command-line tool for the [SMTPing](https://smtping.com) email verification API.

- Zero dependencies, Node 18+ (uses native `fetch`)
- ESM and CommonJS, TypeScript types included
- Automatic retries on rate limits (429) and server errors (5xx)
- Bulk jobs up to 100,000 addresses, with polling built in
- `smtping` CLI to verify addresses or a CSV file from the terminal

## Install

```bash
npm install @smtping/sdk
```

Create an API key in the [SMTPing dashboard](https://app.smtping.com). Pass it to the client or set `SMTPING_API_KEY`.

## Verify one address

```js
import Smtping from '@smtping/sdk';

const smtping = new Smtping({ apiKey: process.env.SMTPING_API_KEY });

const r = await smtping.verify('jane@example.com');
console.log(r.status, r.band); // "valid" "safe"
```

CommonJS works too:

```js
const { Smtping } = require('@smtping/sdk');
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
import { AuthenticationError, InsufficientCreditsError, RateLimitError } from '@smtping/sdk';

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
npm install -g @smtping/sdk      # or run any command with npx @smtping/sdk
smtping auth login               # asks for the key, tests it, saves it
smtping verify jane@example.com john@example.org
smtping bulk contacts.csv --wait --out results.csv
smtping check disposable jane@example.com
smtping credits
smtping raw GET /credits         # any API endpoint
```

- Output is a table in a terminal and JSON in a pipe (`--json` / `--table` to force).
- Bulk jobs ask before spending credits; add `--yes` in scripts and CI.
- `--fail-on avoid` or `--fail-on judgement` turns verdicts into exit codes.
- Shell completion: `smtping completion bash|zsh|fish|powershell`.
- The key is read from `--key`, then `SMTPING_API_KEY`, then `~/.config/smtping/config.json`.

| exit code | meaning |
| --- | --- |
| 0 | ok |
| 1 | error |
| 2 | usage error or cancelled |
| 3 | missing or invalid API key |
| 4 | not enough credits |
| 5 | rate limited |
| 10 | an address is `avoid` (with `--fail-on`) |
| 11 | an address is `judgement` (with `--fail-on judgement`) |

Full guide: [smtping.com/cli](https://smtping.com/cli)

## Links

- [API documentation](https://smtping.com/docs)
- [Pricing](https://smtping.com/pricing)
- Support: support@smtping.com
- Blog: [SMTPedia](https://smtpedia.com)

MIT License
