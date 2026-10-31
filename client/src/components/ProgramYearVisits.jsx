import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';

const PERIODS = [
  { value: 'all', label: 'All time' },
  { value: 'year', label: 'This year' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
];

const number = new Intl.NumberFormat();
const dayMedium = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });
const dateOf = (key) => new Date(`${key}T00:00:00Z`);
const visitsText = (n) => `${number.format(n)} ${n === 1 ? 'visit' : 'visits'}`;
const percent = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0.0%');

export const yearLabel = (level) => {
  if (level === null) return 'Year not recorded';
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
  return `${level}${suffix} Year`;
};

// Programs and year levels as totals, from the cells the server counted.
// Everything on screen (table, charts, tiles) comes from this one shape, so
// they always agree with each other and with the filters.
export function summarize(rows) {
  const programs = new Map();
  const years = new Map();
  for (const r of rows) {
    const p = programs.get(r.program) || { program: r.program, total: 0, byYear: new Map() };
    p.total += r.visits;
    p.byYear.set(r.yearLevel, (p.byYear.get(r.yearLevel) || 0) + r.visits);
    programs.set(r.program, p);
    years.set(r.yearLevel, (years.get(r.yearLevel) || 0) + r.visits);
  }
  return {
    programs: [...programs.values()].sort((a, b) => b.total - a.total || a.program.localeCompare(b.program)),
    // Year 1, 2, 3 ... and the visits with no year level last.
    years: [...years.entries()]
      .map(([level, visits]) => ({ level, visits }))
      .sort((a, b) => (a.level ?? 99) - (b.level ?? 99)),
  };
}

const yearClass = (level) => `yr-${level ?? 0}`;

// A row of horizontal bars. The same numbers are in the table, so the bars are decoration.
export function HBars({ items }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="hbars">
      {items.map((i) => (
        <li className="hbar" key={i.key}>
          <span className="hbar-label">{i.label}</span>
          <span className="hbar-track" aria-hidden="true">
            <span className={`hbar-fill ${i.className || ''}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="hbar-value">
            {number.format(i.value)} <span className="muted">({i.share})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// One bar per program, split into a colour per year level. Bar lengths compare programs.
export function StackedBars({ programs, levels }) {
  const max = Math.max(...programs.map((p) => p.total), 1);
  return (
    <>
      <ul className="stack-legend" aria-label="Year levels">
        {levels.map((l) => (
          <li key={l}>
            <span className={`stack-swatch ${yearClass(l)}`} aria-hidden="true" />
            {yearLabel(l)}
          </li>
        ))}
      </ul>
      <ul className="hbars">
        {programs.map((p) => (
          <li className="hbar" key={p.program}>
            <span className="hbar-label">{p.program}</span>
            <span className="hbar-track" aria-hidden="true">
              {levels.map((l) => {
                const v = p.byYear.get(l) || 0;
                return v > 0 ? (
                  <span
                    key={l}
                    className={`hbar-fill stack-seg ${yearClass(l)}`}
                    style={{ width: `${(v / max) * 100}%` }}
                    title={`${p.program}, ${yearLabel(l)}: ${visitsText(v)}`}
                  />
                ) : null;
              })}
            </span>
            <span className="hbar-value">
              {number.format(p.total)}
              <span className="sr-only">
                {' '}
                ({levels.filter((l) => p.byYear.get(l)).map((l) => `${yearLabel(l)} ${p.byYear.get(l)}`).join(', ')})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Tile({ label, value, detail }) {
  return (
    <div className="peak-tile">
      <dt>{label}</dt>
      <dd>{value ?? '–'}</dd>
      <p className="muted">{detail || 'No visits yet'}</p>
    </div>
  );
}

export default function ProgramYearVisits() {
  const [period, setPeriod] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [year, setYear] = useState('');
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
    if (year) qs.set('year', year);
    api(`/statistics/program-year?${qs}`)
      .then((r) => {
        if (id !== latest.current) return;
        setData(r);
        setError('');
      })
      .catch((err) => id === latest.current && setError(err.message))
      .finally(() => id === latest.current && setLoading(false));
  }, [period, from, to, year, customReady, customError, refreshKey]);

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

  const view = useMemo(() => (data ? summarize(data.rows) : null), [data]);
  const total = data?.total || 0;
  const shownYear = data?.yearLevel ? yearLabel(data.yearLevel) : 'All year levels';
  const top = view?.programs[0];
  const bottom = view && view.programs.length > 1 ? view.programs[view.programs.length - 1] : null;
  const topYear = view?.years.length ? view.years.reduce((a, b) => (b.visits > a.visits ? b : a)) : null;
  const levels = view ? view.years.map((y) => y.level) : [];
  const periodLabel = data ? `${dayMedium.format(dateOf(data.from))} to ${dayMedium.format(dateOf(data.to))}` : '';

  return (
    <section className="panel peak" aria-labelledby="py-h" aria-busy={loading}>
      <div className="table-head">
        <div>
          <h2 id="py-h">Library Visits by Academic Program and Year Level</h2>
          <p className="muted">
            Which programs and year levels account for the recorded visits. Each student counts once per day, using
            the program and year level on their student record.
          </p>
        </div>
      </div>

      <div className="analytics-controls">
        <div className="filter">
          <label htmlFor="py-period">Period</label>
          <select id="py-period" className="field-select" value={period} onChange={onPeriod}>
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
              <label htmlFor="py-from">From</label>
              <input id="py-from" type="date" className="field-select" value={from} max={to || data?.today} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="filter">
              <label htmlFor="py-to">To</label>
              <input id="py-to" type="date" className="field-select" value={to} min={from || undefined} max={data?.today} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        <div className="filter">
          <label htmlFor="py-year">Year level</label>
          <select id="py-year" className="field-select" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All year levels</option>
            {(data?.yearLevels || []).map((l) => (
              <option key={l} value={l}>
                {yearLabel(l)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(customError || error) && <div className="alert alert-error" role="alert">{customError || error}</div>}
      {period === 'custom' && !customReady && <p className="empty">Choose a start and end date.</p>}
      {!data && loading && <p className="muted pad">Loading…</p>}

      {data && view && customReady && !customError && (
        <>
          <p className="analytics-period" role="status">
            <strong>{number.format(total)}</strong> {total === 1 ? 'visit' : 'visits'} from {periodLabel} · {shownYear}
          </p>

          {total === 0 ? (
            <p className="empty">
              {data.yearLevel
                ? `No visits by ${shownYear} students were recorded in this period.`
                : 'No visits by students with a recorded program were found in this period.'}
            </p>
          ) : (
            <>
              <dl className="peak-tiles">
                <Tile label="Most visits" value={top.program} detail={`${visitsText(top.total)} · ${percent(top.total, total)} of visits`} />
                <Tile
                  label="Fewest visits"
                  value={bottom?.program}
                  detail={bottom && `${visitsText(bottom.total)} · ${percent(bottom.total, total)} of visits`}
                />
                <Tile
                  label={data.yearLevel ? 'Year level shown' : 'Busiest year level'}
                  value={topYear && yearLabel(topYear.level)}
                  detail={topYear && `${visitsText(topYear.visits)} · ${percent(topYear.visits, total)} of visits`}
                />
                <Tile label="Programs with visits" value={number.format(view.programs.length)} detail={visitsText(total)} />
              </dl>

              <div className="table-scroll">
                <table className="stats-table trends-table">
                  <caption className="sr-only">Total visits per academic program, {shownYear}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Academic Program</th>
                      <th scope="col">Year Level</th>
                      <th scope="col" className="num">Total Visits</th>
                      <th scope="col" className="num">% of Visits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.programs.map((p) => (
                      <tr key={p.program}>
                        <td>{p.program}</td>
                        <td>{shownYear}</td>
                        <td className="num">{number.format(p.total)}</td>
                        <td className="num">{percent(p.total, total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={2}>Total</th>
                      <td className="num strong">{number.format(total)}</td>
                      <td className="num strong">{percent(total, total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <h3 className="trends-heading">Comparison of visits among programs</h3>
              <HBars
                items={view.programs.map((p) => ({ key: p.program, label: p.program, value: p.total, share: percent(p.total, total) }))}
              />

              <h3 className="trends-heading">Program usage across year levels</h3>
              <StackedBars programs={view.programs} levels={levels} />

              <h3 className="trends-heading">Total visits per year level</h3>
              <HBars
                items={view.years.map((y) => ({
                  key: String(y.level),
                  label: yearLabel(y.level),
                  value: y.visits,
                  share: percent(y.visits, total),
                  className: yearClass(y.level),
                }))}
              />

              {data.leftOut > 0 && !data.yearLevel && (
                <p className="muted peak-hours">
                  {visitsText(data.leftOut)} by accounts without a program, such as staff, {data.leftOut === 1 ? 'is' : 'are'} not counted here.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
