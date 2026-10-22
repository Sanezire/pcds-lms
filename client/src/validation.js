// Mirrors the server rules so people get instant feedback.
// The server still validates everything again.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]*$/u;
const MEMBER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_\-/]*$/;

export function validateRegister(v) {
  const e = {};
  const name = v.fullName.trim().replace(/\s+/g, ' ');
  const email = v.email.trim();
  const memberId = v.memberId.trim();

  if (name.length < 2 || name.length > 100) e.fullName = 'Enter your full name (2 to 100 characters).';
  else if (!NAME_RE.test(name)) e.fullName = 'Use letters, spaces, periods, apostrophes and hyphens only.';

  if (!email) e.email = 'Enter your email address.';
  else if (email.length > 255 || !EMAIL_RE.test(email)) e.email = 'Enter a valid email address.';

  if (!memberId) e.memberId = 'Enter your student or staff ID.';
  else if (memberId.length < 3 || memberId.length > 32 || !MEMBER_ID_RE.test(memberId))
    e.memberId = 'ID must be 3 to 32 characters: letters, numbers, hyphens, underscores or slashes.';

  const p = v.password;
  if (!p) e.password = 'Enter a password.';
  else if (p.length < 8) e.password = 'Password must be at least 8 characters.';
  else if (new TextEncoder().encode(p).length > 72) e.password = 'Password must be 72 bytes or fewer.';
  else if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p))
    e.password = 'Use at least one uppercase letter, one lowercase letter and one number.';

  if (!v.confirmPassword) e.confirmPassword = 'Confirm your password.';
  else if (v.password !== v.confirmPassword) e.confirmPassword = 'Passwords do not match.';

  return e;
}

export function validateLogin(v) {
  const e = {};
  if (!v.identifier.trim()) e.identifier = 'Enter your email or student/staff ID.';
  if (!v.password) e.password = 'Enter your password.';
  return e;
}
