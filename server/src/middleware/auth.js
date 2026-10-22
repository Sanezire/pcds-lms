import { config } from '../config.js';
import { findSessionUser } from '../sessions.js';

export function httpError(status, message, fields) {
  const err = new Error(message);
  err.status = status;
  err.fields = fields;
  return err;
}

// Attaches req.user when a valid session cookie is present; rejects otherwise.
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[config.session.cookieName];
    if (!token || typeof token !== 'string') {
      throw httpError(401, 'You need to sign in to continue.');
    }

    const user = await findSessionUser(token);
    if (!user) {
      res.clearCookie(config.session.cookieName, { path: '/' });
      throw httpError(401, 'Your session has expired. Sign in again.');
    }
    if (user.status !== 'active') {
      throw httpError(403, 'This account is not active. Contact the library administrator.');
    }

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(httpError(403, 'You do not have permission to do that.'));
    }
    next();
  };
}

// Lightweight CSRF defence on top of SameSite cookies: browsers will not let a
// cross-site page attach a custom header without a CORS preflight, which the
// CORS policy rejects.
export function requireCustomHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'pcds-lms') {
    return next(httpError(403, 'Request blocked.'));
  }
  next();
}
