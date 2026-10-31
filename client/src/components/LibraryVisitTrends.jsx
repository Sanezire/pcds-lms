import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';

const REPORTS = [
  { value: 'daily', label: 'Daily summary' },
  { value: 'monthly', label: 'Monthly summary' },
  { value: 'annual', label: 'Annual summary' },
  { value: 'compare', label: 'Compare years' },
  { value: 'custom', label: 'Custom date range' },
];
const MAX_COMPARE = 4;
const SERIES_COLORS = ['#2f7fc1', '#d9822b', '#1f9d8a', '#7a5cc0'];
const HEIGHT = 280;
const M = { top: 22, right: 16, bottom: 30, left: 46 };

const number = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const utc = (key) => new Date(key.length === 7 ? `${key}-01T00:00:00Z` : key.length === 4 ? `${key}-01-01T00:00:00Z` : `${key}T00:00:00Z`);
const f = (opts) => {
  const fmt = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...opts });
  return (key) => fmt.format(utc(key));
};
const dayLong = f({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const dayNum = f({ day: 'numeric' });
const monthShort = f({ month: 'short' });
const monthName = f({ month: 'long' });
const monthYear = f({ month: 'long', year: 'numeric' });
const dayMedium = f({ dateStyle: 'medium' });
const dayMonth = f({ month: 'short', day: 'numeric' });

function niceTicks(max) {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough);
  const ticks = [];
  for (let v = 0; v <= Math.ceil(max / step) * step; v += step) ticks.push(v);
  return ticks;
}

function useWidth(ref) {
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth || 600);
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

// One chart for every report: bars for comparing buckets, lines for trends.
// `series` is [{ name, color, buckets: [{ key, visits, future }] }] sharing the same keys.
export function TrendChart({ type, series, axisLabel, tipTitle, ariaLabel }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [active, setActive] = useState(null);

  const count = series[0].buckets.length;
  const max = Math.max(0, ...series.flatMap((s) => s.buckets.map((b) => b.visits)));
  const ticks = useMemo(() => niceTicks(max), [max]);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = HEIGHT - M.top - M.bottom;
  const band = plotW / count;
  const x = (i) => M.left + band * (i + 0.5);
  const y = (v) => M.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(44 / band));
  const barW = Math.min(band * 0.64, 28);
  const peak = series.length === 1 ? series[0].buckets.reduce((bi, b, i, a) => (b.visits > a[bi].visits ? i : bi), 0) : -1;

  function pick(clientX) {
    const rect = wrapRef.current.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - M.left) / band);
    setActive(i >= 0 && i < count ? i : null);
  }
  function onKey(e) {
    if (e.key === 'ArrowRight') setActive((a) => Math.min((a ?? -1) + 1, count - 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max((a ?? count) - 1, 0));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  }

  const tipLeft = active !== null ? x(active) : 0;

  return (
    <div className="tchart" ref={wrapRef}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onMouseMove={(e) => pick(e.clientX)}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'tchart-base' : 'tchart-grid'} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tchart-tick">
              {compact.format(t)}
            </text>
          </g>
        ))}
        {series[0].buckets.map((b, i) =>
          i % labelEvery === 0 ? (
            <text key={b.key} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="tchart-tick">
              {axisLabel(b.key)}
            </text>
          ) : null
        )}

        {active !== null && type === 'bar' && (
          <rect x={M.left + band * active} y={M.top} width={band} height={plotH} className="tchart-hover" />
        )}
        {active !== null && type === 'line' && (
          <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} className="tchart-cursor" />
        )}

        {type === 'bar' &&
          series[0].buckets.map((b, i) =>
            b.future || b.visits === 0 ? null : (
              <g key={b.key}>
                <rect
                  x={x(i) - barW / 2}
                  y={y(b.visits)}
                  width={barW}
                  height={y(0) - y(b.visits)}
                  rx="3"
                  className={`tchart-bar${active === i ? ' is-active' : ''}`}
                />
                {i === peak && (
                  <text x={x(i)} y={y(b.visits) - 6} textAnchor="middle" className="tchart-peak">
                    {number.format(b.visits)}
                  </text>
                )}
              </g>
            )
          )}

        {type === 'line' &&
          series.map((s) => {
            const pts = s.buckets.map((b, i) => (b.future ? null : [x(i), y(b.visits)]));
            const segs = [];
            let cur = [];
            pts.forEach((p) => {
              if (p) cur.push(p);
              else if (cur.length) { segs.push(cur); cur = []; }
            });
            if (cur.length) segs.push(cur);
            const dots = count <= 40;
            return (
              <g key={s.name} style={{ color: s.color }}>
                {segs.map((seg, k) => (
                  <polyline key={k} points={seg.map((p) => p.join(',')).join(' ')} className="tchart-line" />
                ))}
                {dots &&
                  pts.map((p, i) =>
                    p ? <circle key={i} cx={p[0]} cy={p[1]} r={active === i ? 5 : 3.5} className="tchart-dot" /> : null
                  )}
              </g>
            );
          })}
      </svg>

      {active !== null && (
        <div className="tchart-tip" style={{ left: Math.min(Math.max(tipLeft, 70), width - 70) }} role="status">
          <span className="tchart-tip-title">{tipTitle(series[0].buckets[active].key)}</span>
          {series.map((s) => (
            <span key={s.name} className="tchart-tip-row">
              {series.length > 1 && <i style={{ background: s.color }} />}
              {series.length > 1 && <em>{s.name}</em>}
              <strong>{s.buckets[active].future ? '–' : number.format(s.buckets[active].visits)}</strong>
              {series.length === 1 && <span> {s.buckets[active].visits === 1 ? 'visit' : 'visits'}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Legend({ series }) {
  return (
    <ul className="tchart-legend" aria-label="Years">
      {series.map((s) => (
        <li key={s.name}>
          <i style={{ background: s.color }} /> {s.name}
        </li>
      ))}
    </ul>
  );
}

function SummaryTable({ data, rowLabel }) {
  if (data.series) {
    const rows = data.series[0].buckets.map((b, i) => ({ month: Number(b.key.slice(5)), i }));
    return (
      <table className="stats-table trends-table">
        <thead>
          <tr>
            <th scope="col">Month</th>
            {data.series.map((s) => (
              <th scope="col" className="num" key={s.year}>{s.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ i }) => (
            <tr key={i}>
              <td>{monthName(data.series[0].buckets[i].key)}</td>
              {data.series.map((s) => (
                <td className="num" key={s.year}>
                  {s.buckets[i].future ? <span className="muted">–</span> : number.format(s.buckets[i].visits)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {data.series.map((s) => (
              <td className="num strong" key={s.year}>{number.format(s.buckets.reduce((n, b) => n + b.visits, 0))}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    );
  }
  return (
    <table className="stats-table trends-table">
      <thead>
        <tr>
          <th scope="col">{rowLabel}</th>
          <th scope="col" className="num">Total Visits</th>
        </tr>
      </thead>
      <tbody>
        {data.buckets.map((b) => (
          <tr key={b.key}>
            <td>{data.granularity === 'month' ? monthName(b.key) + (data.report === 'custom' ? ` ${b.key.slice(0, 4)}` : '') : data.granularity === 'year' ? b.key : dayLong(b.key)}</td>
            <td className="num">{b.future ? <span className="muted">–</span> : number.format(b.visits)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td className="num strong">{number.format(data.total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

export default function LibraryVisitTrends() {
  const [report, setReport] = useState('monthly');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [picked, setPicked] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [chartType, setChartType] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const latest = useRef(0);
  const silent = useRef(false);

  const years = data?.years || [];
  const today = data?.today;

  // Defaults come from the server's own idea of "today" and of which years have data.
  useEffect(() => {
    if (!data) return;
    setMonth((m) => m || data.today.slice(0, 7));
    setYear((y) => y || String(data.today.slice(0, 4)));
    setPicked((p) => (p.length ? p : data.years.slice(-2).map(String)));
  }, [data]);

  const customErr = report === 'custom' && from && to && from > to ? 'The start date cannot be after the end date.' : '';
  const compareErr = report === 'compare' && picked.length < 2 ? 'Choose at least two years to compare.' : '';
  const ready =
    !customErr && !compareErr && (report !== 'custom' || (from && to)) && (report !== 'compare' || picked.length >= 2);

  useEffect(() => {
    if (!ready) return;
    const id = ++latest.current;
    const quiet = silent.current;
    silent.current = false;
    if (!quiet) setLoading(true);
    const qs = new URLSearchParams({ report });
    if (report === 'daily' && month) qs.set('month', month);
    if (report === 'monthly' && year) qs.set('year', year);
    if (report === 'compare') qs.set('years', [...picked].sort().join(','));
    if (report === 'custom') {
      qs.set('from', from);
      qs.set('to', to);
    }
    api(`/statistics/trends?${qs}`)
      .then((r) => {
        if (id !== latest.current) return;
        setData(r);
        setError('');
      })
      .catch((err) => {
        if (id === latest.current) setError(err.message);
      })
      .finally(() => {
        if (id === latest.current) setLoading(false);
      });
  }, [report, month, year, picked, from, to, ready, refreshKey]);

  useLiveReload(['attendance'], () => {
    silent.current = true;
    setRefreshKey((k) => k + 1);
  });

  function onReport(e) {
    const value = e.target.value;
    if (value === 'custom' && !from && today) {
      const start = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1));
      setFrom(start.toISOString().slice(0, 10));
      setTo(today);
    }
    setReport(value);
    setChartType('');
  }

  function toggleYear(y) {
    setPicked((p) => {
      if (p.includes(y)) return p.filter((v) => v !== y);
      return p.length >= MAX_COMPARE ? p : [...p, y];
    });
  }

  // Data of the current report only: stale data from another report is not drawn.
  const current = data && data.report === report ? data : null;
  const defaultType = !current ? 'bar' : current.series || current.granularity === 'day' ? 'line' : 'bar';
  const type = current?.series ? 'line' : chartType || defaultType;

  const chart = useMemo(() => {
    if (!current) return null;
    if (current.series) {
      return current.series.map((s, i) => ({ name: String(s.year), color: SERIES_COLORS[i % SERIES_COLORS.length], buckets: s.buckets }));
    }
    return [{ name: 'Visits', color: SERIES_COLORS[0], buckets: current.buckets }];
  }, [current]);

  const g = current?.granularity;
  const axisLabel = (key) => (g === 'day' ? (current.buckets.length <= 8 ? dayMonth(key) : dayNum(key)) : g === 'year' ? key : monthShort(key));
  const tipTitle = (key) => (g === 'day' ? dayLong(key) : g === 'year' ? key : current.series ? monthName(key) : monthYear(key));

  let heading = '';
  if (current) {
    if (report === 'daily') heading = `Daily library visits for ${monthYear(current.label)}`;
    else if (report === 'monthly') heading = `Monthly library visits for ${current.label}`;
    else if (report === 'annual') heading = 'Yearly library visits';
    else if (report === 'compare') heading = `Monthly library visits: ${current.label}`;
    else heading = `Library visits from ${dayMedium(current.from)} to ${dayMedium(current.to)}`;
  }
  const rowLabel = g === 'day' ? 'Date' : g === 'year' ? 'Year' : 'Month';

  return (
    <section className="panel trends" aria-labelledby="trends-h" aria-busy={loading}>
      <div className="table-head">
        <div>
          <h2 id="trends-h">Library Visit Trends</h2>
          <p className="muted">
            See how library usage changes over time. Pick a reporting period to view daily, monthly or yearly visit
            counts, or compare years. A student counts once per day.
          </p>
        </div>
      </div>

      <div className="analytics-controls">
        <div className="filter">
          <label htmlFor="t-report">Reporting period</label>
          <select id="t-report" className="field-select" value={report} onChange={onReport}>
            {REPORTS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {report === 'daily' && (
          <div className="filter">
            <label htmlFor="t-month">Month</label>
            <input id="t-month" type="month" className="field-select" value={month} max={today?.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
        )}
        {report === 'monthly' && (
          <div className="filter">
            <label htmlFor="t-year">Year</label>
            <select id="t-year" className="field-select" value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}
        {report === 'custom' && (
          <>
            <div className="filter">
              <label htmlFor="t-from">From</label>
              <input id="t-from" type="date" className="field-select" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="filter">
              <label htmlFor="t-to">To</label>
              <input id="t-to" type="date" className="field-select" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        {report === 'compare' && (
          <fieldset className="trends-years">
            <legend>Years to compare (2 to {MAX_COMPARE})</legend>
            <div>
              {years.map((y) => {
                const on = picked.includes(String(y));
                return (
                  <label key={y} className={`year-chip${on ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && picked.length >= MAX_COMPARE}
                      onChange={() => toggleYear(String(y))}
                    />
                    {y}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {current && !current.series && (
          <div className="filter trends-type">
            <span id="t-type">Chart</span>
            <div className="seg" role="radiogroup" aria-labelledby="t-type">
              {['line', 'bar'].map((t) => (
                <button key={t} type="button" role="radio" aria-checked={type === t} className={`seg-btn${type === t ? ' is-active' : ''}`} onClick={() => setChartType(t)}>
                  {t === 'line' ? 'Line' : 'Bar'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {(customErr || compareErr || error) && (
        <div className="alert alert-error" role="alert">{customErr || compareErr || error}</div>
      )}
      {!data && loading && <p className="muted pad">Loading trends…</p>}

      {current && ready && (
        <div className="trends-body">
          <h3 className="trends-heading">{heading}</h3>
          <p className="analytics-period" role="status">
            <strong>{number.format(current.total)}</strong> {current.total === 1 ? 'visit' : 'visits'} in total
          </p>
          {current.total === 0 ? (
            <p className="empty">No visits were recorded for this selection.</p>
          ) : (
            <>
              {current.series && <Legend series={chart} />}
              <TrendChart type={type} series={chart} axisLabel={axisLabel} tipTitle={tipTitle} ariaLabel={`${type === 'line' ? 'Line' : 'Bar'} chart. ${heading}. Full numbers are in the table below.`} />
            </>
          )}
          <div className="table-scroll">
            <SummaryTable data={current} rowLabel={rowLabel} />
          </div>
        </div>
      )}
    </section>
  );
}
