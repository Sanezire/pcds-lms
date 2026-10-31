// Year levels offered when recording a student, and how they read on screen.
export const YEAR_LEVELS = [1, 2, 3, 4];

export function yearLabel(level) {
  if (level === null || level === undefined || level === '') return 'Year not recorded';
  const n = Number(level);
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix} Year`;
}
