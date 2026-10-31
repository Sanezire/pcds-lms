import { REGISTERABLE_ROLES } from './config.js';

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

// With autoId the ID is assigned by the server, so none is expected from the form.
export function validateRegistration(body = {}, { autoId = false } = {}) {
  const fullName = asString(body.fullName).trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(body.email);
  const memberId = normalizeMemberId(body.memberId);
  const password = asString(body.password);
  const confirmPassword = asString(body.confirmPassword);
  const registrationKey = asString(body.registrationKey).trim();
  const role = asString(body.role).trim();

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

  if (!autoId) {
    if (!memberId) {
      errors.memberId = 'Enter your ID.';
    } else if (memberId.length < 3 || memberId.length > 32 || !MEMBER_ID_RE.test(memberId)) {
      errors.memberId = 'ID must be 3 to 32 characters using letters, numbers, hyphens, underscores or slashes.';
    }
  }

  const passwordError = checkPassword(password);
  if (passwordError) errors.password = passwordError;

  if (!confirmPassword) {
    errors.confirmPassword = 'Confirm your password.';
  } else if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (!REGISTERABLE_ROLES.includes(role)) errors.role = 'Choose a role.';

  if (!registrationKey) {
    errors.registrationKey = 'Enter the registration key.';
  } else if (registrationKey.length > 128) {
    errors.registrationKey = 'That key is too long.';
  }

  return { errors, values: { fullName, email, memberId, password, registrationKey, role } };
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
  const yearText = String(body.yearLevel ?? '').trim();
  const yearLevel = /^[1-4]$/.test(yearText) ? Number(yearText) : null;
  const errors = {};

  if (name.length < 2 || name.length > 100) errors.name = 'Enter the student’s full name (2 to 100 characters).';
  else if (!NAME_RE.test(name)) errors.name = 'Name can only contain letters, spaces, periods, apostrophes and hyphens.';

  if (!studentId) errors.studentId = 'Enter the student ID.';
  else if (studentId.length < 3 || studentId.length > 32 || !MEMBER_ID_RE.test(studentId))
    errors.studentId = 'ID must be 3 to 32 characters using letters, numbers, hyphens, underscores or slashes.';

  if (course.length < 2 || course.length > 100) errors.course = 'Enter the course (2 to 100 characters).';

  if (yearLevel === null) errors.yearLevel = 'Choose a year level.';

  if (!GENDERS.includes(gender)) errors.gender = 'Choose a gender.';

  return { errors, values: { name, studentId, course, gender, yearLevel } };
}

export const MESSAGE_MAX = 500;
const SCANNABLE_ID_RE = /^[A-Za-z0-9_-]{3,32}$/;

// Message text keeps line breaks but drops other control characters.
export function cleanMessage(value) {
  return asString(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

// For fields that may be left empty (an ID can have just a Time In or just a Time Out message).
export function validateOptionalMessage(value) {
  const message = cleanMessage(value);
  if (message.length > MESSAGE_MAX) return { error: `Messages can be up to ${MESSAGE_MAX} characters.`, message };
  return { error: null, message };
}

export function validateMessageText(value) {
  const message = cleanMessage(value);
  if (!message) return { error: 'Enter a message.', message };
  if (message.length > MESSAGE_MAX) return { error: `Messages can be up to ${MESSAGE_MAX} characters.`, message };
  return { error: null, message };
}

// IDs are limited to what the kiosk reader can actually scan.
export function validateRuleId(value) {
  const studentId = normalizeMemberId(value);
  if (!studentId) return { error: 'Enter an ID.', studentId };
  if (!SCANNABLE_ID_RE.test(studentId)) {
    return { error: 'ID must be 3 to 32 characters: letters, numbers, hyphens or underscores.', studentId };
  }
  return { error: null, studentId };
}

// ---- Student records (students_data) ----
const RFID_RE = /^[0-9A-Fa-f]{4,32}$/;
const STUDENT_NUMBER_RE = /^[0-9]{4}-[0-9]{4}-[0-9]$/;
const GENDER_WORDS = { male: 'male', m: 'male', female: 'female', f: 'female', other: 'other', o: 'other' };

export function validateStudentRecord(body = {}) {
  const rfidNumber = asString(body.rfidNumber).trim().toUpperCase();
  const studentId = asString(body.studentId).trim();
  const fullName = asString(body.fullName).trim().replace(/\s+/g, ' ');
  const course = asString(body.course).trim().replace(/\s+/g, ' ');
  const gender = GENDER_WORDS[asString(body.gender).trim().toLowerCase()] || '';
  const yearText = String(body.yearLevel ?? '').trim();
  const yearLevel = /^[1-4]$/.test(yearText) ? Number(yearText) : null;
  const errors = {};

  if (!RFID_RE.test(rfidNumber)) errors.rfidNumber = 'RFID number must be 4 to 32 hexadecimal characters (0-9, A-F).';
  if (!STUDENT_NUMBER_RE.test(studentId)) errors.studentId = 'Student ID must look like 2025-1042-3.';
  if (fullName.length < 2 || fullName.length > 100) errors.fullName = 'Enter the full name (2 to 100 characters).';
  else if (!NAME_RE.test(fullName)) errors.fullName = 'Name can only contain letters, spaces, periods, apostrophes and hyphens.';
  if (course.length < 2 || course.length > 100) errors.course = 'Enter the course (2 to 100 characters).';
  if (!gender) errors.gender = 'Choose a gender.';
  if (yearLevel === null) errors.yearLevel = 'Year level must be 1 to 4.';

  return { errors, values: { rfidNumber, studentId, fullName, course, gender, yearLevel } };
}
