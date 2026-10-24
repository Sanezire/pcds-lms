const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_RE = /^[\p{L}][\p{L}\p{M} .'-]*$/u;
const MEMBER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_\-/]*$/;

const asString = (v) => (typeof v === 'string' ? v : '');

export function normalizeEmail(value) {
  return asString(value).trim().toLowerCase();
}

export function normalizeMemberId(value) {
  return asString(value).trim().toUpperCase();
}

export function validateRegistration(body = {}) {
  const fullName = asString(body.fullName).trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(body.email);
  const memberId = normalizeMemberId(body.memberId);
  const password = asString(body.password);
  const confirmPassword = asString(body.confirmPassword);
  const registrationKey = asString(body.registrationKey).trim();

  const errors = {};

  if (fullName.length < 2 || fullName.length > 100) {
    errors.fullName = 'Enter your full name (2 to 100 characters).';
  } else if (!NAME_RE.test(fullName)) {
    errors.fullName = 'Full name can only contain letters, spaces, periods, apostrophes and hyphens.';
  }

  if (!email) {
    errors.email = 'Enter your email address.';
  } else if (email.length > 255 || !EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (!memberId) {
    errors.memberId = 'Enter your admin ID.';
  } else if (memberId.length < 3 || memberId.length > 32 || !MEMBER_ID_RE.test(memberId)) {
    errors.memberId = 'ID must be 3 to 32 characters using letters, numbers, hyphens, underscores or slashes.';
  }

  const passwordError = checkPassword(password);
  if (passwordError) errors.password = passwordError;

  if (!confirmPassword) {
    errors.confirmPassword = 'Confirm your password.';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (!registrationKey) {
    errors.registrationKey = 'Enter the admin registration key.';
  } else if (registrationKey.length > 128) {
    errors.registrationKey = 'That key is too long.';
  }

  return { errors, values: { fullName, email, memberId, password, registrationKey } };
}

export function checkPassword(password) {
  if (!password) return 'Enter a password.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  // bcrypt only uses the first 72 bytes, so reject anything longer instead of truncating silently.
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be 72 bytes or fewer.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return 'Use at least one uppercase letter, one lowercase letter and one number.';
  }
  return null;
}

export function validateLogin(body = {}) {
  const identifier = asString(body.identifier).trim();
  const password = asString(body.password);
  const errors = {};

  if (!identifier) errors.identifier = 'Enter your email or ID.';
  else if (identifier.length > 255) errors.identifier = 'That value is too long.';

  if (!password) errors.password = 'Enter your password.';
  else if (password.length > 1024) errors.password = 'That value is too long.';

  // Only a real boolean true counts; anything else means a normal sign-in.
  const remember = body.remember === true;

  return { errors, values: { identifier, password, remember } };
}

export const GENDERS = Object.freeze(['male', 'female', 'other']);

export function validateManualAttendance(body = {}) {
  const name = asString(body.name).trim().replace(/\s+/g, ' ');
  const studentId = normalizeMemberId(body.studentId);
  const course = asString(body.course).trim().replace(/\s+/g, ' ');
  const gender = asString(body.gender).trim().toLowerCase();
  const errors = {};

  if (name.length < 2 || name.length > 100) errors.name = 'Enter the student’s full name (2 to 100 characters).';
  else if (!NAME_RE.test(name)) errors.name = 'Name can only contain letters, spaces, periods, apostrophes and hyphens.';

  if (!studentId) errors.studentId = 'Enter the student ID.';
  else if (studentId.length < 3 || studentId.length > 32 || !MEMBER_ID_RE.test(studentId))
    errors.studentId = 'ID must be 3 to 32 characters using letters, numbers, hyphens, underscores or slashes.';

  if (course.length < 2 || course.length > 100) errors.course = 'Enter the course (2 to 100 characters).';

  if (!GENDERS.includes(gender)) errors.gender = 'Choose a gender.';

  return { errors, values: { name, studentId, course, gender } };
}
