import crypto from 'node:crypto';
import { config } from '../config.js';
import { httpError } from './auth.js';

const digest = (value) => crypto.createHash('sha256').update(value).digest();

// The kiosk screen has no sign-in. If KIOSK_KEY is set, its requests must carry
// that key, in the X-Kiosk-Key header or (for the live stream, which cannot set
// headers) the ?key= query. With no key configured the kiosk is open.
export function requireKioskKey(req, res, next) {
  const expected = config.kiosk.key;
  if (!expected) return next();
  const given = req.get('x-kiosk-key') || (typeof req.query.key === 'string' ? req.query.key : '');
  if (!crypto.timingSafeEqual(digest(given), digest(expected))) {
    return next(httpError(403, 'This kiosk is not authorized.'));
  }
  next();
}
