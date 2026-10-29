import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';

const PERIODS = [
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range' },
];

const number = new Intl.NumberFormat();
const dayLong = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const dayShort = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Keys are school-local dates (YYYY-MM-DD) or months (YYYY-MM), so they are
// formatted in UTC to keep the date exactly as the server counted it.
const asDate = (key) => new Date(key.length === 7 ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`);

// Picks a round top value and evenly spaced gridlines for the bar heights.
function scaleFor(max) {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

function VisitChart({ bars, granularity }) {
  const max = bars.reduce((m, b) => Math.max(m, b.visits), 0);
  const { top, ticks } = useMemo(() => scaleFor(max), [max]);
  const labelEvery = granularity === 'month' ? 1 : bars.length > 31 ? 7 : bars.length > 14 ? 2 : 1;
  const showValues = bars.length <= 16;

  const describe = (b) =>
    granularity === 'month' ? monthLong.format(asDate(b.key)) : dayLong.format(asDate(b.key));

  return (
    <div className="chart" role="img" aria-label={`Bar graph of library visits: ${bars.length} ${granularity === 'month' ? 'months' : 'days'}.`}>
      <div className="chart-axis" aria-hidden="true">
        {[...ticks].reverse().map((t) => (
          <span key={t}>{number.format(t)}</span>
        ))}
      </div>
      <div className="chart-scroll">
        <div className="chart-plot" style={{ minWidth: `${Math.max(bars.length * 26, 320)}px` }}>
          <div className="chart-grid" aria-hidden="true">
            {ticks.map((t) => (
              <i key={t} />
            ))}
          </div>
          <div className="chart-bars">
            {bars.map((b, i) => (
              <div className="chart-col" key={b.key} title={`${describe(b)}: ${number.format(b.visits)} ${b.visits === 1 ? 'visit' : 'visits'}`}>
                <div className="chart-barwrap">
                  {showValues && b.visits > 0 && <span className="chart-value">{number.format(b.visits)}</span>}
                  <span className="chart-bar" style={{ height: `${(b.visits / top) * 100}%` }} />
                </div>
                <span className="chart-label">
                  {i % labelEvery === 0
                    ? granularity === 'month'
                      ? monthShort.format(asDate(b.key))
                      : dayShort.format(asDate(b.key))
                    : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [period, setPeriod] = useState('last30');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const latestRequest = useRef(0);
  const silentRef = useRef(false);

  const customReady = period !== 'custom' || (from && to);
  const customError = period === 'custom' && from && to && from > to ? 'The start date cannot be after the end date.' : '';

  useEffect(() => {
    if (!customReady || customError) return;
    const requestId = ++latestRequest.current;
    const silent = silentRef.current;
    silentRef.current = false;
    if (!silent) setLoading(true);

    const qs = new URLSearchParams({ range: period });
    if (period === 'custom') {
      qs.set('from', from);
      qs.set('to', to);
    }
    api(`/statistics/visits?${qs}`)
      .then((result) => {
        if (requestId !== latestRequest.current) return;
        setData(result);
        setError('');
      })
      .catch((err) => {
        if (requestId === latestRequest.current) setError(err.message);
      })
      .finally(() => {
        if (requestId === latestRequest.current) setLoading(false);
      });
  }, [period, from, to, customReady, customError, refreshKey]);

  // New taps and manual entries update the graph without a page refresh.
  useLiveReload(['attendance'], () => {
    silentRef.current = true;
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

  const summary = data?.summary;
  const rows = summary
    ? [
        ['Total library visits', summary.total],
        ['Visits this month', summary.thisMonth],
        ['Visits this week', summary.thisWeek],
        ['Visits today', summary.today],
        ['Unique students who visited this month', summary.studentsThisMonth],
      ]
    : [];
  const hasVisits = data && data.periodTotal > 0;

  return (
    <section className="panel analytics" aria-labelledby="visits-h" aria-busy={loading}>
      <div className="table-head">
        <div>
          <h2 id="visits-h">Library Visit Summary</h2>
          <p className="muted">
            Students who visited the library in the selected period. A student who times in and out several times
            in one day counts as one visit.
          </p>
        </div>
      </div>

      <div className="analytics-controls">
        <div className="filter">
          <label htmlFor="a-period">Period</label>
          <select id="a-period" className="field-select" value={period} onChange={onPeriod}>
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div className="filter">
              <label htmlFor="a-from">From</label>
              <input id="a-from" type="date" className="field-select" value={from} max={to || data?.today} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="filter">
              <label htmlFor="a-to">To</label>
              <input id="a-to" type="date" className="field-select" value={to} min={from || undefined} max={data?.today} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
      </div>

      {customError && (
        <div className="alert alert-error" role="alert">
          {customError}
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {!data && loading && <p className="muted pad">Loading visits…</p>}

      {data && (
        <>
          <p className="analytics-period" role="status">
            <strong>{number.format(data.periodTotal)}</strong> {data.periodTotal === 1 ? 'visit' : 'visits'} from{' '}
            {dayLong.format(asDate(data.from))} to {dayLong.format(asDate(data.to))}
          </p>
          {hasVisits ? (
            <VisitChart bars={data.bars} granularity={data.granularity} />
          ) : (
            <p className="empty">No visits were recorded in this period.</p>
          )}

          <div className="table-scroll">
            <table className="stats-table summary-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col" className="num">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, value]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="num strong">{number.format(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
