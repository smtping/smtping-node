import mod from './index.cjs';

export const {
  Smtping, band, isEmail, VERSION,
  SmtpingError, AuthenticationError, InsufficientCreditsError,
  RateLimitError, ValidationError, JobFailedError, TimeoutError,
} = mod;
export default mod.Smtping;
