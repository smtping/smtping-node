#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Smtping, isEmail, VERSION } = require('./index.cjs');

const CONFIG = path.join(os.homedir(), '.config', 'smtping', 'config.json');
const HELP = `SMTPing CLI ${VERSION}

Usage
  smtping login <api-key>              Save your API key locally
  smtping logout                       Remove the saved key
  smtping verify <email> [email...]    Verify one or more addresses
  smtping check <type> <email>         spamtrap | disposable | spambot | complainer
  smtping bulk <file> [--wait]         Submit a CSV or TXT file as one job
  smtping status <job-id>              Progress of a bulk job
  smtping results <job-id>             Download results of a finished job
  smtping credits                      Remaining credits

Options
  --key <key>      API key (else SMTPING_API_KEY, else saved key)
  --json           Raw JSON output
  --out <file>     Write results to a CSV file (bulk, results)
  --wait           Wait for the bulk job to finish (bulk)
  -h, --help       Show help
  -v, --version    Show version

Docs: https://smtping.com/docs`;

function parseArgs(argv) {
  const args = { _: [], json: false, wait: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--wait') args.wait = true;
    else if (a === '--key') args.key = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else if (a === '-v' || a === '--version') args.version = true;
    else args._.push(a);
  }
  return args;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; }
}

function client(args) {
  const apiKey = args.key || process.env.SMTPING_API_KEY || readConfig().apiKey;
  if (!apiKey) fail('No API key. Run "smtping login <api-key>" or set SMTPING_API_KEY.');
  return new Smtping({ apiKey, userAgent: `smtping-cli/${VERSION}` });
}

function fail(msg, code = 1) {
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(code);
}

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (b, s) => !color ? s : b === 'safe' ? `\x1b[32m${s}\x1b[0m` : b === 'avoid' ? `\x1b[31m${s}\x1b[0m` : `\x1b[33m${s}\x1b[0m`;

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
  if (!fs.existsSync(file)) fail(`File not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const found = text.match(/[^\s,;"'<>]+@[^\s,;"'<>]+\.[^\s,;"'<>]+/g) || [];
  return [...new Set(found.map((e) => e.toLowerCase()).filter(isEmail))];
}

function summary(rows) {
  const c = { safe: 0, avoid: 0, judgement: 0 };
  rows.forEach((r) => { if (c[r.band] != null) c[r.band]++; });
  process.stderr.write(`\n${rows.length} verified: ${c.safe} safe, ${c.avoid} avoid, ${c.judgement} judgement\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = args._;
  if (args.version) return console.log(VERSION);
  if (args.help || !cmd) return console.log(HELP);
  const out = (data) => console.log(JSON.stringify(data, null, 2));

  switch (cmd) {
    case 'login': {
      const key = rest[0] || args.key;
      if (!key) fail('Usage: smtping login <api-key>');
      const c = await new Smtping({ apiKey: key }).credits();
      fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
      fs.writeFileSync(CONFIG, JSON.stringify({ apiKey: key }, null, 2), { mode: 0o600 });
      console.log(`Key saved to ${CONFIG}. Credits: ${c.remaining}${c.plan ? ` (${c.plan})` : ''}`);
      return;
    }
    case 'logout': {
      try { fs.unlinkSync(CONFIG); } catch {}
      console.log('Saved key removed.');
      return;
    }
    case 'verify': {
      if (!rest.length) fail('Usage: smtping verify <email> [email...]');
      const rows = await client(args).verifyMany(rest);
      if (args.json) return out(rows.length === 1 ? rows[0] : rows);
      printRows(rows);
      if (rows.some((r) => r.status === 'error')) process.exitCode = 1;
      return;
    }
    case 'check': {
      const [type, email] = rest;
      if (!type || !email) fail('Usage: smtping check <spamtrap|disposable|spambot|complainer> <email>');
      return out(await client(args).check(type, email));
    }
    case 'credits': {
      const c = await client(args).credits();
      if (args.json) return out(c);
      console.log(`${c.remaining} credits${c.plan ? ` (${c.plan})` : ''}`);
      return;
    }
    case 'bulk': {
      const file = rest[0];
      if (!file) fail('Usage: smtping bulk <file.csv|file.txt> [--wait] [--out results.csv]');
      const emails = emailsFromFile(file);
      if (!emails.length) fail('No email address found in the file.');
      const api = client(args);
      const job = await api.bulk.create(emails);
      process.stderr.write(`Job ${job.jobId} created for ${emails.length} unique addresses.\n`);
      if (!args.wait) {
        if (args.json) return out(job);
        console.log(job.jobId);
        process.stderr.write(`Check progress: smtping status ${job.jobId}\n`);
        return;
      }
      const rows = await api.bulk.wait(job.jobId, {
        timeout: 2 * 3600000,
        onProgress: (s) => process.stderr.write(`\r${s.processedEmails || 0} / ${emails.length} verified`),
      });
      process.stderr.write('\n');
      return emit(rows, args);
    }
    case 'status': {
      if (!rest[0]) fail('Usage: smtping status <job-id>');
      const s = await client(args).bulk.get(rest[0]);
      if (args.json) return out(s);
      console.log(`${s.status}  ${s.processedEmails ?? 0} / ${s.totalEmails ?? '?'}${s.errorMessage ? `  ${s.errorMessage}` : ''}`);
      return;
    }
    case 'results': {
      if (!rest[0]) fail('Usage: smtping results <job-id> [--out results.csv]');
      return emit(await client(args).bulk.results(rest[0]), args);
    }
    default:
      fail(`Unknown command "${cmd}". Run "smtping --help".`);
  }
}

function emit(rows, args) {
  if (args.out) { writeCsv(args.out, rows); summary(rows); return; }
  if (args.json) return console.log(JSON.stringify(rows, null, 2));
  printRows(rows);
  summary(rows);
}

main().catch((e) => fail(e.message, e.status === 401 || e.status === 403 ? 2 : 1));
