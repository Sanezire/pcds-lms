import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';
import { formatMinutes } from '../durations.js';

const number = new Intl.NumberFormat();
const dateLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateLocal = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const hourText = (h) => `${h % 12 || 12}:00 ${h % 24 < 12 ? 'AM' : 'PM'}`;

export function useDashboardSummary() {
  const [summary, setSummary] = useState(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const data = await api('/dashboard/summary');
      if (id === latest.current) setSummary(data);
    } catch {
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveReload(['attendance'], load);

  return summary;
}

export function DashboardGreeting({ name, summary }) {
  const day = summary ? dateLong.format(new Date(`${summary.today}T00:00:00Z`)) : dateLocal.format(new Date());
  let hours = '';
  if (summary) {
    const weekday = (new Date(`${summary.today}T00:00:00Z`).getUTCDay() + 6) % 7;
    hours = summary.hours.closedWeekdays.includes(weekday)
      ? 'Library closed today'
      : `Library hours ${hourText(summary.hours.open)} – ${hourText(summary.hours.close)}`;
  }
  return (
    <header className="dash-greeting">
      <h1>Welcome, {name}</h1>
      <p className="dash-meta">
        <time dateTime={summary?.today}>{day}</time>
        {hours && (
          <>
            <span className="dash-dot" aria-hidden="true">
              ·
            </span>
            <span>{hours}</span>
          </>
        )}
      </p>
    </header>
  );
}

function Tile({ label, value, detail, tone }) {
  return (
    <div className={`summary-tile${tone ? ` is-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <p className="muted">{detail}</p>
    </div>
  );
}

export function SummaryTiles({ summary }) {
  const n = (v) => (summary ? number.format(v) : '–');
  const average = summary ? summary.averageStayMinutes : null;
  return (
    <dl className="summary-tiles" aria-label="Today at a glance">
      <Tile label="Visits today" value={n(summary?.visitsToday)} detail="Each student counted once" />
      <Tile label="Inside now" value={n(summary?.insideNow)} detail="Timed in, not yet out" tone="in" />
      <Tile
        label="Timed out today"
        value={n(summary?.timedOutToday)}
        detail={average === null ? 'No time outs yet' : `Average stay ${formatMinutes(average)}`}
      />
      <Tile label="Manual entries today" value={n(summary?.manualToday)} detail="Recorded by staff" />
    </dl>
  );
}
