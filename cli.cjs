#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { Smtping, isEmail, VERSION } = require('./index.cjs');

const CONFIG = path.join(os.homedir(), '.config', 'smtping', 'config.json');
const KEYS_URL = 'https://app.smtping.com';
const COMMANDS = ['auth', 'login', 'logout', 'verify', 'check', 'bulk', 'status', 'results', 'credits', 'raw', 'completion', 'version', 'help'];
const CHECK_TYPES = ['spamtrap', 'disposable', 'spambot', 'complainer'];

// Exit codes, stable across versions.
const EXIT = { OK: 0, ERROR: 1, USAGE: 2, AUTH: 3, CREDITS: 4, RATE_LIMIT: 5, AVOID: 10, JUDGEMENT: 11 };

const HELP = `SMTPing CLI ${VERSION}

Usage
  smtping auth login [api-key]           Save your API key (asks for it if omitted)
  smtping auth status                    Show which key is used and the credits left
  smtping auth logout                    Remove the saved key
  smtping verify <email> [email...]      Verify one or more addresses
  smtping check <type> <email>           spamtrap | disposable | spambot | complainer
  smtping bulk <file> [--wait]           Submit a CSV or TXT file as one bulk job
  smtping status <job-id>                Progress of a bulk job
  smtping results <job-id>               Results of a finished job
  smtping credits                        Remaining credits
  smtping raw <METHOD> <path>            Call any API endpoint, e.g. raw GET /credits
  smtping completion <shell>             bash | zsh | fish | powershell

Options
  --key <key>          API key (else SMTPING_API_KEY, else the saved key)
  --json               JSON output (default when stdout is not a terminal)
  --table              Table output, even in a pipe
  --out <file>         Write results to a CSV file (bulk, results)
  --wait               Wait for the bulk job to finish (bulk)
  --fail-on <band>     Exit with a verdict code: avoid (10) or judgement (10 or 11)
  --data <json|@file>  Request body (raw)
  -y, --yes            Do not ask before spending credits on a bulk job
  -h, --help           Show help
  -v, --version        Show version

Exit codes
  0 ok, 1 error, 2 usage, 3 invalid key, 4 no credits, 5 rate limited,
  10 an address is avoid, 11 an address is judgement (with --fail-on)

Docs: https://smtping.com/cli`;

function parseArgs(argv) {
  const args = { _: [], wait: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.format = 'json';
    else if (a === '--table') args.format = 'table';
    else if (a === '--wait') args.wait = true;
    else if (a === '-y' || a === '--yes') args.yes = true;
    else if (a === '--key') args.key = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--fail-on') args.failOn = argv[++i];
    else if (a === '--data' || a === '-d') args.data = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-v' || a === '--version') args.version = true;
    else args._.push(a);
  }
  if (!args.format) args.format = process.stdout.isTTY ? 'table' : 'json';
  return args;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

function keySource(args) {
  if (args.key) return ['--key', args.key];
  if (process.env.SMTPING_API_KEY) return ['SMTPING_API_KEY', process.env.SMTPING_API_KEY];
  const saved = readConfig().apiKey;
  if (saved) return [CONFIG, saved];
  return [null, null];
}

function client(args) {
  const [, apiKey] = keySource(args);
  if (!apiKey) fail('No API key. Run "smtping auth login" or set SMTPING_API_KEY.', EXIT.AUTH);
  return new Smtping({ apiKey, userAgent: `smtping-cli/${VERSION}` });
}

function fail(msg, code = EXIT.ERROR) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

const mask = (k) => (k.length > 12 ? `${k.slice(0, 8)}...${k.slice(-4)}` : '****');
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (b, s) => !color ? s : b === 'safe' ? `\x1b[32m${s}\x1b[0m` : b === 'avoid' ? `\x1b[31m${s}\x1b[0m` : `\x1b[33m${s}\x1b[0m`;
const json = (data) => console.log(JSON.stringify(data, null, 2));

function printRows(rows) {
  const w = Math.max(5, ...rows.map((r) => String(r.email || '').length));
  for (const r of rows) {
    const b = r.band || '';
    process.stdout.write(`${String(r.email || '').padEnd(w)}  ${paint(b, String(r.status).padEnd(12))}  ${paint(b, b.padEnd(9))}  ${r.statusDescription || ''}\n`);
  }
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(file, rows) {
  const cols = ['email', 'status', 'band', 'statusDescription', 'isDisposable', 'isFreeDomain', 'isRoleBasedDomain', 'isTypos'];
  const lines = [cols.join(',')].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')));
  fs.writeFileSync(file, lines.join('\n') + '\n');
  process.stderr.write(`Wrote ${rows.length} rows to ${file}\n`);
}

function emailsFromFile(file) {
  if (!fs.existsSync(file)) fail(`File not found: ${file}`, EXIT.USAGE);
  const text = fs.readFileSync(file, 'utf8');
  const found = text.match(/[^\s,;"'<>]+@[^\s,;"'<>]+\.[^\s,;"'<>]+/g) || [];
  return [...new Set(found.map((e) => e.toLowerCase()).filter(isEmail))];
}

function summary(rows) {
  const c = { safe: 0, avoid: 0, judgement: 0 };
  rows.forEach((r) => { if (c[r.band] != null) c[r.band]++; });
  process.stderr.write(`\n${rows.length} verified: ${c.safe} safe, ${c.avoid} avoid, ${c.judgement} judgement\n`);
}

function verdictExit(rows, args) {
  if (rows.some((r) => r.status === 'error')) process.exitCode = EXIT.ERROR;
  if (!args.failOn) return;
  if (!['avoid', 'judgement'].includes(args.failOn)) fail('--fail-on takes avoid or judgement.', EXIT.USAGE);
  if (rows.some((r) => r.band === 'avoid')) process.exitCode = EXIT.AVOID;
  else if (args.failOn === 'judgement' && rows.some((r) => r.band === 'judgement')) process.exitCode = EXIT.JUDGEMENT;
}

function emit(rows, args) {
  if (args.out) { writeCsv(args.out, rows); summary(rows); }
  else if (args.format === 'json') json(rows);
  else { printRows(rows); summary(rows); }
  verdictExit(rows, args);
}

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    }
    rl.question(question, (answer) => {
      if (hidden) process.stderr.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirmSpend(count, args) {
  if (args.yes) return;
  if (!process.stdin.isTTY) fail(`This job uses up to ${count} credits. Add --yes to run it without a terminal.`, EXIT.USAGE);
  const a = await ask(`Verify ${count} addresses, up to ${count} credits (unknown results are free). Continue? [y/N] `);
  if (!/^y(es)?$/i.test(a)) fail('Cancelled.', EXIT.USAGE);
}

async function login(keyArg) {
  let key = keyArg;
  if (!key) {
    if (!process.stdin.isTTY) fail('Usage: smtping auth login <api-key>', EXIT.USAGE);
    process.stderr.write(`Create an API key in the SMTPing dashboard: ${KEYS_URL} (API keys).\n`);
    key = await ask('Paste your API key: ', true);
  }
  if (!key) fail('No key entered.', EXIT.USAGE);
  const c = await new Smtping({ apiKey: key, userAgent: `smtping-cli/${VERSION}` }).credits();
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ apiKey: key }, null, 2), { mode: 0o600 });
  process.stderr.write(`Key ${mask(key)} saved to ${CONFIG}. Credits: ${c.remaining}${c.plan ? ` (${c.plan})` : ''}\n`);
}

function logout() {
  try { fs.unlinkSync(CONFIG); } catch {}
  process.stderr.write('Saved key removed.\n');
}

async function authStatus(args) {
  const [src, key] = keySource(args);
  if (!key) fail('Not logged in. Run "smtping auth login".', EXIT.AUTH);
  const c = await client(args).credits();
  if (args.format === 'json') return json({ key: mask(key), source: src, ...c });
  console.log(`Key ${mask(key)} from ${src}\n${c.remaining} credits${c.plan ? ` (${c.plan})` : ''}`);
}

function parseData(d) {
  if (d == null) return undefined;
  const text = d.startsWith('@') ? fs.readFileSync(d.slice(1), 'utf8') : d;
  try { return JSON.parse(text); } catch { fail('--data must be valid JSON.', EXIT.USAGE); }
}

function completion(shell) {
  const cmds = COMMANDS.join(' ');
  const opts = '--key --json --table --out --wait --fail-on --data --yes --help --version';
  const scripts = {
    bash: `_smtping() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"; prev="\${COMP_WORDS[COMP_CWORD-1]}"
  case "$prev" in
    smtping) COMPREPLY=($(compgen -W "${cmds}" -- "$cur")); return;;
    auth) COMPREPLY=($(compgen -W "login status logout" -- "$cur")); return;;
    check) COMPREPLY=($(compgen -W "${CHECK_TYPES.join(' ')}" -- "$cur")); return;;
    completion) COMPREPLY=($(compgen -W "bash zsh fish powershell" -- "$cur")); return;;
    raw) COMPREPLY=($(compgen -W "GET POST PUT DELETE" -- "$cur")); return;;
    --fail-on) COMPREPLY=($(compgen -W "avoid judgement" -- "$cur")); return;;
    bulk|--out) COMPREPLY=($(compgen -f -- "$cur")); return;;
  esac
  COMPREPLY=($(compgen -W "${opts}" -- "$cur"))
}
complete -F _smtping smtping
`,
    zsh: `#compdef smtping
_smtping() {
  local -a cmds
  cmds=(${COMMANDS.map((c) => `'${c}'`).join(' ')})
  case $words[2] in
    auth) _values 'auth' login status logout;;
    check) _values 'type' ${CHECK_TYPES.join(' ')};;
    completion) _values 'shell' bash zsh fish powershell;;
    raw) _values 'method' GET POST PUT DELETE;;
    bulk) _files;;
    *) if (( CURRENT == 2 )); then _describe 'command' cmds; else _values 'option' ${opts}; fi;;
  esac
}
compdef _smtping smtping
`,
    fish: `complete -c smtping -f
complete -c smtping -n "__fish_use_subcommand" -a "${cmds}"
complete -c smtping -n "__fish_seen_subcommand_from auth" -a "login status logout"
complete -c smtping -n "__fish_seen_subcommand_from check" -a "${CHECK_TYPES.join(' ')}"
complete -c smtping -n "__fish_seen_subcommand_from completion" -a "bash zsh fish powershell"
complete -c smtping -n "__fish_seen_subcommand_from raw" -a "GET POST PUT DELETE"
complete -c smtping -n "__fish_seen_subcommand_from bulk" -F
complete -c smtping -l key -r
complete -c smtping -l json
complete -c smtping -l table
complete -c smtping -l out -r -F
complete -c smtping -l wait
complete -c smtping -l fail-on -r -a "avoid judgement"
complete -c smtping -l data -r
complete -c smtping -s y -l yes
`,
    powershell: `Register-ArgumentCompleter -Native -CommandName smtping -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  $list = switch ($words[1]) {
    'auth' { 'login','status','logout' }
    'check' { ${CHECK_TYPES.map((c) => `'${c}'`).join(',')} }
    'completion' { 'bash','zsh','fish','powershell' }
    'raw' { 'GET','POST','PUT','DELETE' }
    default { if ($words.Count -le 2) { ${COMMANDS.map((c) => `'${c}'`).join(',')} } else { ${opts.split(' ').map((o) => `'${o}'`).join(',')} } }
  }
  $list | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`,
  };
  if (!scripts[shell]) {
    fail(`Usage: smtping completion <bash|zsh|fish|powershell>

  bash        smtping completion bash > /etc/bash_completion.d/smtping
  zsh         smtping completion zsh > "\${fpath[1]}/_smtping"
  fish        smtping completion fish > ~/.config/fish/completions/smtping.fish
  powershell  smtping completion powershell | Out-String | Invoke-Expression
              (add that line to $PROFILE to load it in every session)`, EXIT.USAGE);
  }
  process.stdout.write(scripts[shell]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  if (args.version || cmd === 'version') return console.log(VERSION);
  if (args.help || !cmd || cmd === 'help') return console.log(HELP);

  switch (cmd) {
    case 'auth': {
      const [sub, key] = rest;
      if (sub === 'login') return login(key || args.key);
      if (sub === 'logout') return logout();
      if (sub === 'status') return authStatus(args);
      fail('Usage: smtping auth <login|status|logout>', EXIT.USAGE);
    }
    case 'login': return login(rest[0] || args.key);
    case 'logout': return logout();
    case 'verify': {
      if (!rest.length) fail('Usage: smtping verify <email> [email...]', EXIT.USAGE);
      const rows = await client(args).verifyMany(rest);
      if (args.format === 'json') json(rows.length === 1 ? rows[0] : rows);
      else printRows(rows);
      return verdictExit(rows, args);
    }
    case 'check': {
      const [type, email] = rest;
      if (!CHECK_TYPES.includes(type) || !email) fail('Usage: smtping check <spamtrap|disposable|spambot|complainer> <email>', EXIT.USAGE);
      return json(await client(args).check(type, email));
    }
    case 'credits': {
      const c = await client(args).credits();
      if (args.format === 'json') return json(c);
      console.log(`${c.remaining} credits${c.plan ? ` (${c.plan})` : ''}`);
      return;
    }
    case 'bulk': {
      const file = rest[0];
      if (!file) fail('Usage: smtping bulk <file.csv|file.txt> [--wait] [--out results.csv] [--yes]', EXIT.USAGE);
      const emails = emailsFromFile(file);
      if (!emails.length) fail('No email address found in the file.', EXIT.USAGE);
      await confirmSpend(emails.length, args);
      const api = client(args);
      const job = await api.bulk.create(emails);
      process.stderr.write(`Job ${job.jobId} created for ${emails.length} unique addresses.\n`);
      if (!args.wait) {
        if (args.format === 'json') return json(job);
        console.log(job.jobId);
        process.stderr.write(`Check progress: smtping status ${job.jobId}\n`);
        return;
      }
      const rows = await api.bulk.wait(job.jobId, {
        timeout: 2 * 3600000,
        onProgress: (s) => { if (process.stderr.isTTY) process.stderr.write(`\r${s.processedEmails || 0} / ${emails.length} verified`); },
      });
      if (process.stderr.isTTY) process.stderr.write('\n');
      return emit(rows, args);
    }
    case 'status': {
      if (!rest[0]) fail('Usage: smtping status <job-id>', EXIT.USAGE);
      const s = await client(args).bulk.get(rest[0]);
      if (args.format === 'json') return json(s);
      console.log(`${s.status}  ${s.processedEmails ?? 0} / ${s.totalEmails ?? '?'}${s.errorMessage ? `  ${s.errorMessage}` : ''}`);
      return;
    }
    case 'results': {
      if (!rest[0]) fail('Usage: smtping results <job-id> [--out results.csv]', EXIT.USAGE);
      return emit(await client(args).bulk.results(rest[0]), args);
    }
    case 'raw': {
      const [method, p] = rest;
      if (!method || !p) fail('Usage: smtping raw <GET|POST|PUT|DELETE> <path> [--data <json|@file>]', EXIT.USAGE);
      const route = p.replace(/^\/?(api\/v1)?/, '/').replace(/^\/+/, '/');
      return json(await client(args).request(method.toUpperCase(), route, parseData(args.data)));
    }
    case 'completion': return completion(rest[0]);
    default:
      fail(`Unknown command "${cmd}". Run "smtping --help".`, EXIT.USAGE);
  }
}

function exitCodeFor(e) {
  if (e.status === 401 || e.status === 403 || e.name === 'AuthenticationError') return EXIT.AUTH;
  if (e.status === 402 || e.name === 'InsufficientCreditsError') return EXIT.CREDITS;
  if (e.status === 429 || e.name === 'RateLimitError') return EXIT.RATE_LIMIT;
  return EXIT.ERROR;
}

main().catch((e) => fail(e.message, exitCodeFor(e)));
