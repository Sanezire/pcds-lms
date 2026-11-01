export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return '–';
  const total = Math.max(Math.round(minutes), 0);
  if (total < 1) return 'Under 1m';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
