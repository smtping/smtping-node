export type Status =
  | 'valid' | 'alias' | 'invalid' | 'catch_all' | 'unknown' | 'spamtrap' | 'disposable'
  | 'blacklisted' | 'complainer' | 'spambot' | 'inbox_full' | 'role' | (string & {});

export type Band = 'safe' | 'avoid' | 'judgement';
export type CheckType = 'spamtrap' | 'disposable' | 'spambot' | 'complainer';
export type JobStatus = 'Queued' | 'Processing' | 'Succeeded' | 'Failed' | 'Cancelled' | (string & {});

export interface VerifyResult {
  email: string;
  status: Status;
  statusDescription?: string;
  band: Band;
  isDisposable?: boolean;
  isFreeDomain?: boolean;
  isRoleBasedDomain?: boolean;
  isTypos?: boolean;
  [key: string]: unknown;
}

export interface CheckResult { email: string; check: CheckType; [key: string]: unknown }
export interface Credits { remaining: number; plan?: string; [key: string]: unknown }

export interface BulkJob {
  jobId: string;
  status: JobStatus;
  totalEmails?: number;
  processedEmails?: number;
  errorMessage?: string;
  [key: string]: unknown;
}

export interface WaitOptions {
  /** Max wait in ms. Default 30 minutes. */
  timeout?: number;
  /** First poll interval in ms, grows to 30 s. Default 5000. */
  interval?: number;
  onProgress?: (job: BulkJob) => void;
}

export interface SmtpingOptions {
  /** Defaults to process.env.SMTPING_API_KEY */
  apiKey?: string;
  baseUrl?: string;
  /** Per-request timeout in ms. Default 60000. */
  timeout?: number;
  /** Retries on network errors, 429 and 5xx. Default 3. */
  maxRetries?: number;
  userAgent?: string;
}

export declare class Smtping {
  constructor(options?: SmtpingOptions | string);
  verify(email: string): Promise<VerifyResult>;
  verifyMany(emails: string[], options?: { concurrency?: number }): Promise<VerifyResult[]>;
  check(type: CheckType, email: string): Promise<CheckResult>;
  credits(): Promise<Credits>;
  readonly bulk: {
    create(emails: string[]): Promise<BulkJob>;
    get(jobId: string): Promise<BulkJob>;
    results(jobId: string): Promise<VerifyResult[]>;
    wait(jobId: string, options?: WaitOptions): Promise<VerifyResult[]>;
    run(emails: string[], options?: WaitOptions): Promise<VerifyResult[]>;
  };
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export declare function band(status: string): Band;
export declare function isEmail(value: string): boolean;
export declare const VERSION: string;

export declare class SmtpingError extends Error { status: number; body: unknown }
export declare class AuthenticationError extends SmtpingError {}
export declare class InsufficientCreditsError extends SmtpingError {}
export declare class RateLimitError extends SmtpingError {}
export declare class ValidationError extends SmtpingError {}
export declare class JobFailedError extends SmtpingError { job: BulkJob }
export declare class TimeoutError extends SmtpingError {}

export default Smtping;
