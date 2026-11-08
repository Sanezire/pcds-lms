import rateLimit from 'express-rate-limit';

const tooMany = (message) => (req, res) =>
  res.status(429).json({ error: { message } });

const base = { standardHeaders: true, legacyHeaders: false };

// General ceiling per client IP, against floods. Staff screens refresh several
// charts at once on every change, and several tabs (and the kiosk) on one computer
// share an IP, so it is set well above what normal use needs. Sign-in, the kiosk
// scan, registration and exports have their own, much tighter limits below.
const perMinute = Number.parseInt(process.env.API_RATE_LIMIT_PER_MINUTE ?? '', 10);
export const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: Number.isInteger(perMinute) && perMinute > 0 ? perMinute : 600,
  handler: tooMany('Too many requests. Wait a moment and try again.'),
});

// Brute-force protection for sign in: one limiter per client IP and one per
// account identifier, so both a single attacker and a distributed attack on
// one account are slowed down. Successful logins do not count.
export const loginIpLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  handler: tooMany('Too many sign-in attempts. Try again in 15 minutes.'),
});

export const loginIdentifierLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const id = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    return `login:${id.slice(0, 255)}`;
  },
  handler: tooMany('Too many failed attempts for this account. Try again in 15 minutes.'),
});

export const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  handler: tooMany('Too many registration attempts. Try again later.'),
});

// Building a report reads a lot of attendance data, so exports are limited per client IP.
export const reportLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 20,
  handler: tooMany('Too many exports. Wait a moment and try again.'),
});

// The kiosk scan has no sign-in, so it is limited per client IP to slow down
// anyone trying IDs one after another. A busy desk reader stays well under this.
export const kioskScanLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 60,
  handler: tooMany('Too many scans. Wait a moment and try again.'),
});
