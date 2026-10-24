// Pure helper: turns today's attendance rows into summary numbers.
// Rows need { user_id, action: 'in' | 'out', recorded_at } in time order per user.
// No student identities leave this function.
export function computeStats(rows) {
  const openSince = new Map(); // user_id -> ms of an unfinished Time In
  const visitors = new Set();
  let checkIns = 0;
  let completedSeconds = 0;

  for (const row of rows) {
    const at = new Date(row.recorded_at).getTime();
    if (row.action === 'in') {
      checkIns += 1;
      visitors.add(row.user_id);
      if (!openSince.has(row.user_id)) openSince.set(row.user_id, at);
    } else {
      const start = openSince.get(row.user_id);
      if (start !== undefined) {
        completedSeconds += Math.max(0, (at - start) / 1000);
        openSince.delete(row.user_id);
      }
    }
  }

  return {
    checkInsToday: checkIns,
    visitorsToday: visitors.size,
    currentlyIn: openSince.size,
    completedSeconds: Math.round(completedSeconds),
    openSince: [...openSince.values()].map((ms) => new Date(ms).toISOString()),
  };
}
