import { query } from './db.js';
import { config } from './config.js';

// Library opening hours. The defaults come from .env (see config.js); the super
// admin can change them on the Settings screen, which stores them in app_settings
// and updates config.library in place, so every part of the server uses the new
// hours right away.

const DEFAULTS = { ...config.library, closedWeekdays: [...config.library.closedWeekdays] };
const OFFSET_MS = Math.trunc(config.attendance.utcOffsetMinutes) * 60 * 1000;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Checks hours sent from the Settings screen. Returns { errors, values }.
export function validateHours(body) {
  const errors = {};
  const openHour = Number(body?.openHour);
  const closeHour = Number(body?.closeHour);
  if (!Number.isInteger(openHour) || openHour < 0 || openHour > 23) errors.openHour = 'Choose an opening time.';
  if (!Number.isInteger(closeHour) || closeHour < 1 || closeHour > 24) errors.closeHour = 'Choose a closing time.';
  if (!errors.openHour && !errors.closeHour && closeHour <= openHour) errors.closeHour = 'Closing time must be after opening time.';
  const days = Array.isArray(body?.closedWeekdays) ? body.closedWeekdays.map(Number) : null;
  if (!days || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.closedWeekdays = 'Choose valid days.';
  else if (new Set(days).size === 7) errors.closedWeekdays = 'The library has to be open on at least one day.';
  return { errors, values: { openHour, closeHour, closedWeekdays: [...new Set(days || [])].sort((a, b) => a - b) } };
}

function apply(values) {
  Object.assign(config.library, {
    openHour: values.openHour,
    closeHour: values.closeHour,
    closedWeekdays: [...values.closedWeekdays],
  });
}

// Reads the saved hours (if any) into config.library. Called at start-up and after
// a database import.
export async function loadLibraryHours() {
  const rows = await query(
    `SELECT name, value FROM app_settings WHERE name IN ('library_open_hour', 'library_close_hour', 'library_closed_days')`
  );
  const saved = Object.fromEntries(rows.map((r) => [r.name, r.value]));
  const next = {
    openHour: saved.library_open_hour ?? DEFAULTS.openHour,
    closeHour: saved.library_close_hour ?? DEFAULTS.closeHour,
    closedWeekdays: saved.library_closed_days !== undefined
      ? saved.library_closed_days.split(',').filter((d) => d !== '')
      : DEFAULTS.closedWeekdays,
  };
  const { errors, values } = validateHours(next);
  apply(Object.keys(errors).length ? DEFAULTS : values);
}

export async function saveLibraryHours(values) {
  const rows = [
    ['library_open_hour', String(values.openHour)],
    ['library_close_hour', String(values.closeHour)],
    ['library_closed_days', values.closedWeekdays.join(',')],
  ];
  await query(
    `INSERT INTO app_settings (name, value) VALUES ${rows.map(() => '(?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    rows.flat()
  );
  apply(values);
}

// "8:00 AM", "5:00 PM"; 24 (the end of the day) is "12:00 midnight".
export function hourText(h) {
  if (h === 24) return '12:00 midnight';
  return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
}

export function hoursText() {
  const { openHour, closeHour, closedWeekdays } = config.library;
  const closed = closedWeekdays.map((d) => DAY_NAMES[d]);
  const time = openHour === 0 && closeHour === 24 ? 'Open all day' : `${hourText(openHour)} to ${hourText(closeHour)}`;
  return `${time}${closed.length ? `, closed on ${closed.join(', ')}` : ''}`;
}

// Whether the library is open at this moment (school's local time).
export function libraryStatus(nowMs = Date.now()) {
  const local = new Date(nowMs + OFFSET_MS);
  const weekday = (local.getUTCDay() + 6) % 7; // Monday = 0
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const { openHour, closeHour, closedWeekdays } = config.library;
  const closedToday = closedWeekdays.includes(weekday);
  const open = !closedToday && minute >= openHour * 60 && minute < closeHour * 60;
  return {
    open,
    closedToday,
    opens: hourText(openHour),
    closes: hourText(closeHour),
    hours: hoursText(),
    nextChangeAt: nextChange(nowMs),
  };
}

// The next moment the library opens or closes (ISO time), so the kiosk can switch
// between "open" and "closed" right on time. Null if it never changes.
function nextChange(nowMs) {
  const { openHour, closeHour, closedWeekdays } = config.library;
  const dayStartLocal = Math.floor((nowMs + OFFSET_MS) / 86_400_000) * 86_400_000;
  for (let d = 0; d <= 8; d += 1) {
    const startLocal = dayStartLocal + d * 86_400_000;
    const weekday = (new Date(startLocal).getUTCDay() + 6) % 7;
    if (closedWeekdays.includes(weekday)) continue;
    for (const hour of [openHour, closeHour]) {
      const at = startLocal + hour * 3_600_000 - OFFSET_MS;
      // Open until midnight and open again at midnight the next day is no change.
      if (hour === 24 && openHour === 0 && !closedWeekdays.includes((weekday + 1) % 7)) continue;
      if (hour === 0 && closeHour === 24 && d > 0 && !closedWeekdays.includes((weekday + 6) % 7)) continue;
      if (at > nowMs) return new Date(at).toISOString();
    }
  }
  return null;
}
