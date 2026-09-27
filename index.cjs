'use strict';

const VERSION = '1.0.0';
const DEFAULT_BASE_URL = 'https://api.smtping.com/api/v1';
const SAFE = ['valid', 'alias'];
const AVOID = ['invalid', 'spamtrap', 'disposable', 'blacklisted', 'complainer', 'spambot', 'inbox_full'];
const CHECKS = ['spamtrap', 'disposable', 'spambot', 'complainer'];
const BULK_MAX = 100000;

class SmtpingError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'SmtpingError';
    this.status = status;
    this.body = body;
  }
}
class AuthenticationError extends SmtpingError { constructor(m, s, b) { super(m, s, b); this.name = 'AuthenticationError'; } }
class InsufficientCreditsError extends SmtpingError { constructor(m, s, b) { super(m, s, b); this.name = 'InsufficientCreditsError'; } }
class RateLimitError extends SmtpingError { constructor(m, s, b) { super(m, s, b); this.name = 'RateLimitError'; } }
class ValidationError extends SmtpingError { constructor(m, s, b) { super(m, s, b); this.name = 'ValidationError'; } }
class JobFailedError extends SmtpingError { constructor(m, job) { super(m, 0, job); this.name = 'JobFailedError'; this.job = job; } }
class TimeoutError extends SmtpingError { constructor(m) { super(m, 0); this.name = 'TimeoutError'; } }

function band(status) {
  if (SAFE.includes(status)) return 'safe';
  if (AVOID.includes(status)) return 'avoid';
  return 'judgement';
}

function isEmail(v) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function errorFor(status, body) {
  const msg = (body && (body.error || body.message)) || `SMTPing API returned HTTP ${status}`;
  if (status === 401 || status === 403) return new AuthenticationError(msg, status, body);
  if (status === 402) return new InsufficientCreditsError(msg, status, body);
  if (status === 429) return new RateLimitError(msg, status, body);
  if (status === 400 || status === 422) return new ValidationError(msg, status, body);
  return new SmtpingError(msg, status, body);
}

class Smtping {
  constructor(options = {}) {
    if (typeof options === 'string') options = { apiKey: options };
    const env = typeof process !== 'undefined' && process.env ? process.env : {};
    this.apiKey = options.apiKey || env.SMTPING_API_KEY || '';
    this.baseUrl = String(options.baseUrl || env.SMTPING_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? 60000;
    this.maxRetries = options.maxRetries ?? 3;
    this.userAgent = options.userAgent || `smtping-node/${VERSION}`;
    if (!this.apiKey) throw new AuthenticationError('Missing API key. Pass { apiKey } or set SMTPING_API_KEY.', 0);
  }

  async request(method, path, body) {
    let attempt = 0;
    for (;;) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      let res;
      try {
        res = await fetch(this.baseUrl + path, {
          method,
          headers: {
            'X-API-Key': this.apiKey,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': this.userAgent,
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
      } catch (e) {
        clearTimeout(timer);
        if (attempt++ < this.maxRetries) { await sleep(backoff(attempt)); continue; }
        if (e && e.name === 'AbortError') throw new TimeoutError(`Request timed out after ${this.timeout} ms`);
        throw new SmtpingError(`Network error: ${e && e.message}`, 0);
      }
      clearTimeout(timer);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (res.ok) return data;
      if ((res.status === 429 || res.status >= 500) && attempt++ < this.maxRetries) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : backoff(attempt));
        continue;
      }
      throw errorFor(res.status, data);
    }
  }

  async verify(email) {
    const e = String(email || '').trim();
    if (!e) throw new ValidationError('Email is required', 0);
    const r = await this.request('POST', '/verify/single', { email: e });
    return withBand(r);
  }

  async verifyMany(emails, { concurrency = 5 } = {}) {
    const list = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))];
    const out = new Array(list.length);
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const idx = i++;
        try { out[idx] = await this.verify(list[idx]); }
        catch (err) { out[idx] = { email: list[idx], status: 'error', statusDescription: err.message }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return out;
  }

  async check(type, email) {
    if (!CHECKS.includes(type)) throw new ValidationError(`Unknown check "${type}". Use one of: ${CHECKS.join(', ')}`, 0);
    const e = String(email || '').trim();
    const r = await this.request('POST', `/checks/${type}`, { email: e });
    return { email: e, check: type, ...r };
  }

  async credits() {
    return this.request('GET', '/credits');
  }

  get bulk() {
    const self = this;
    return {
      async create(emails) {
        const list = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter(isEmail))];
        if (!list.length) throw new ValidationError('No valid email address in the list', 0);
        if (list.length > BULK_MAX) throw new ValidationError(`A bulk job accepts up to ${BULK_MAX} addresses`, 0);
        const job = await self.request('POST', '/verify/bulk', { emails: list });
        return { ...job, totalEmails: job.totalEmails ?? list.length };
      },
      async get(jobId) {
        const r = await self.request('GET', `/verify/bulk/${encodeURIComponent(jobId)}`);
        return { jobId, ...r };
      },
      async results(jobId) {
        const r = await self.request('GET', `/verify/bulk/${encodeURIComponent(jobId)}/result`);
        const list = Array.isArray(r) ? r : (r && r.results) || [];
        return list.map(withBand);
      },
      async wait(jobId, { timeout = 30 * 60000, interval = 5000, onProgress } = {}) {
        const deadline = Date.now() + timeout;
        let delay = interval;
        for (;;) {
          const st = await this.get(jobId);
          if (onProgress) onProgress(st);
          if (st.status === 'Succeeded') return this.results(jobId);
          if (st.status === 'Failed' || st.status === 'Cancelled') {
            throw new JobFailedError(`Job ${jobId} ${String(st.status).toLowerCase()}${st.errorMessage ? ': ' + st.errorMessage : ''}`, st);
          }
          if (Date.now() + delay > deadline) throw new TimeoutError(`Job ${jobId} still running after ${Math.round(timeout / 1000)} s`);
          await sleep(delay);
          delay = Math.min(Math.round(delay * 1.5), 30000);
        }
      },
      async run(emails, opts) {
        const job = await this.create(emails);
        return this.wait(job.jobId, opts);
      },
    };
  }
}

function backoff(attempt) {
  return Math.min(1000 * 2 ** (attempt - 1), 15000) + Math.floor(Math.random() * 250);
}

function withBand(r) {
  if (r && typeof r.status === 'string' && !r.band) return { ...r, band: band(r.status) };
  return r;
}

module.exports = Smtping;
module.exports.Smtping = Smtping;
module.exports.default = Smtping;
module.exports.band = band;
module.exports.isEmail = isEmail;
module.exports.VERSION = VERSION;
module.exports.SmtpingError = SmtpingError;
module.exports.AuthenticationError = AuthenticationError;
module.exports.InsufficientCreditsError = InsufficientCreditsError;
module.exports.RateLimitError = RateLimitError;
module.exports.ValidationError = ValidationError;
module.exports.JobFailedError = JobFailedError;
module.exports.TimeoutError = TimeoutError;
