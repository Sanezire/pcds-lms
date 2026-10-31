import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';
import { TrendChart } from './LibraryVisitTrends.jsx';

const PERIODS = [
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];
const GROUPS = [
  { value: 'hour', label: 'By hour' },
  { value: 'weekday', label: 'By day of week' },
  { value: 'month', label: 'By month' },
];

const number = new Intl.NumberFormat();
const visitsText = (n) => `${number.format(n)} ${n === 1 ? 'visit' : 'visits'}`;
const utc = (opts) => {
  const f = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
  return (d) => f.format(d);
};
const weekdayLong = utc({ weekday: 'long' });
const weekdayShort = utc({ weekday: 'short' });
const monthShort = utc({ month: 'short' });
const monthYear = utc({ month: 'long', year: 'numeric' });
const dayMedium = utc({ dateStyle: 'medium' });
const dayDate = (day) => new Date(Date.UTC(2024, 0, 1 + day)); // 1 Jan 2024 was a Monday
const monthDate = (key) => new Date(`${key}-01T00:00:00Z`);

const hourText = (h) => `${h % 12 || 12}:00 ${h % 24 < 12 ? 'AM' : 'PM'}`;
const hourShort = (h) => `${h % 12 || 12} ${h % 24 < 12 ? 'AM' : 'PM'}`;
export const hourRange = (h) => `${hourText(h)}–${hourText(h + 1)}`;

function Tile({ label, value, detail }) {
  return (
    <div className="peak-tile">
      <dt>{label}</dt>
      <dd>{value ?? '–'}</dd>
      <p className="muted">{detail || 'No visits yet'}</p>
    </div>
  );
}

export default function PeakUsage() {
  const [period, setPeriod] = useState('last30');
  const [group, setGroup] = useState('hour');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const latest = useRef(0);
  const quiet = useRef(false);

  const customReady = period !== 'custom' || (from && to);
  const customError = period === 'custom' && from && to && from > to ? 'The start date cannot be after the end date.' : '';

  useEffect(() => {
    if (!customReady || customError) return;
    const id = ++latest.current;
    const silent = quiet.current;
    quiet.current = false;
    if (!silent) setLoading(true);
    const qs = new URLSearchParams({ range: period });
    if (period === 'custom') {
      qs.set('from', from);
      qs.set('to', to);
    }
    api(`/statistics/peak?${qs}`)
      .then((r) => {
        if (id !== latest.current) return;
        setData(r);
        setError('');
      })
      .catch((err) => id === latest.current && setError(err.message))
      .finally(() => id === latest.current && setLoading(false));
  }, [period, from, to, customReady, customError, refreshKey]);

  useLiveReload(['attendance'], () => {
    quiet.current = true;
    setRefreshKey((k) => k + 1);
  });

  function onPeriod(e) {
    const value = e.target.value;
    if (value === 'custom' && data) {
      setFrom((f) => f || data.from);
      setTo((t) => t || data.to);
    }
    setPeriod(value);
  }

  // One shape for the chart and the table, whichever grouping is chosen.
  const view = useMemo(() => {
    if (!data) return null;
    if (group === 'hour') {
      return {
        title: 'Visits by hour',
        column: 'Time Period',
        rows: data.byHour.map((r) => ({ key: String(r.hour), label: hourRange(r.hour), visits: r.visits })),
        axis: (k) => hourShort(Number(k)),
        tip: (k) => hourRange(Number(k)),
      };
    }
    if (group === 'weekday') {
      return {
        title: 'Visits by day of the week',
        column: 'Day',
        rows: data.byWeekday.map((r) => ({ key: String(r.day), label: weekdayLong(dayDate(r.day)), visits: r.visits, closed: r.closed })),
        axis: (k) => weekdayShort(dayDate(Number(k))),
        tip: (k) => weekdayLong(dayDate(Number(k))),
      };
    }
    const manyYears = data.byMonth.length > 12;
    return {
      title: 'Visits by month',
      column: 'Month',
      rows: data.byMonth.map((r) => ({ key: r.month, label: monthYear(monthDate(r.month)), visits: r.visits })),
      axis: (k) => (manyYears ? `${monthShort(monthDate(k))} ${k.slice(2, 4)}` : monthShort(monthDate(k))),
      tip: (k) => monthYear(monthDate(k)),
    };
  }, [data, group]);

  const ins = data?.insights;
  const hours = data?.hours;
  const closedNames = hours ? hours.closedWeekdays.map((d) => weekdayLong(dayDate(d))) : [];
  const hasVisits = data && data.counted > 0;
  const periodLabel = data ? `${dayMedium(new Date(`${data.from}T00:00:00Z`))} to ${dayMedium(new Date(`${data.to}T00:00:00Z`))}` : '';

  return (
    <section className="panel peak" aria-labelledby="peak-h" aria-busy={loading}>
      <div className="table-head">
        <div>
          <h2 id="peak-h">Peak Library Usage</h2>
          <p className="muted">
            When the library is busiest. Each student counts once per day, at the time they first arrived.
          </p>
        </div>
      </div>

      <div className="analytics-controls">
        <div className="filter">
          <label htmlFor="pk-period">Period</label>
          <select id="pk-period" className="field-select" value={period} onChange={onPeriod}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div className="filter">
              <label htmlFor="pk-from">From</label>
              <input id="pk-from" type="date" className="field-select" value={from} max={to || data?.today} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="filter">
              <label htmlFor="pk-to">To</label>
              <input id="pk-to" type="date" className="field-select" value={to} min={from || undefined} max={data?.today} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <div className="filter trends-type">
          <span id="pk-group">Group visits</span>
          <div className="seg" role="radiogroup" aria-labelledby="pk-group">
            {GROUPS.map((g) => (
              <button key={g.value} type="button" role="radio" aria-checked={group === g.value} className={`seg-btn${group === g.value ? ' is-active' : ''}`} onClick={() => setGroup(g.value)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(customError || error) && <div className="alert alert-error" role="alert">{customError || error}</div>}
      {period === 'custom' && !customReady && <p className="empty">Choose a start and end date.</p>}
      {!data && loading && <p className="muted pad">Loading…</p>}

      {data && view && customReady && !customError && (
        <>
          <dl className="peak-tiles">
            <Tile label="Busiest day of the week" value={ins.busiestDay && weekdayLong(dayDate(ins.busiestDay.day))} detail={ins.busiestDay && visitsText(ins.busiestDay.visits)} />
            <Tile label="Busiest month" value={ins.busiestMonth && monthYear(monthDate(ins.busiestMonth.month))} detail={ins.busiestMonth && visitsText(ins.busiestMonth.visits)} />
            <Tile label="Busiest hour" value={ins.busiestHour && hourRange(ins.busiestHour.hour)} detail={ins.busiestHour && visitsText(ins.busiestHour.visits)} />
            <Tile label="Least busy day" value={ins.leastBusyDay && weekdayLong(dayDate(ins.leastBusyDay.day))} detail={ins.leastBusyDay && visitsText(ins.leastBusyDay.visits)} />
            <Tile label="Least busy hour" value={ins.leastBusyHour && hourRange(ins.leastBusyHour.hour)} detail={ins.leastBusyHour && visitsText(ins.leastBusyHour.visits)} />
          </dl>

          <p className="peak-hours muted">
            Library hours: {hourText(hours.open)} to {hourText(hours.close)}
            {closedNames.length > 0 && `, closed ${closedNames.join(' and ')}`}. Only visits during these times are counted
            {data.offHours > 0 && (
              <>
                ; <strong>{number.format(data.offHours)}</strong> {data.offHours === 1 ? 'visit' : 'visits'} outside them {data.offHours === 1 ? 'is' : 'are'} left out
              </>
            )}
            .
          </p>

          <h3 className="trends-heading">{view.title}</h3>
          <p className="analytics-period" role="status">
            <strong>{number.format(data.counted)}</strong> {data.counted === 1 ? 'visit' : 'visits'} from {periodLabel}
          </p>
          {hasVisits ? (
            <TrendChart
              type="bar"
              series={[{ name: 'Visits', color: '#2f7fc1', buckets: view.rows.map((r) => ({ key: r.key, visits: r.visits, future: false })) }]}
              axisLabel={view.axis}
              tipTitle={view.tip}
              ariaLabel={`Bar chart. ${view.title}. Full numbers are in the table below.`}
            />
          ) : (
            <p className="empty">No visits during library hours in this period.</p>
          )}

          <div className="table-scroll">
            <table className="stats-table trends-table">
              <thead>
                <tr>
                  <th scope="col">{view.column}</th>
                  <th scope="col" className="num">Total Visits</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="num">{r.closed ? <span className="muted">Closed</span> : number.format(r.visits)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="num strong">{number.format(data.counted)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
