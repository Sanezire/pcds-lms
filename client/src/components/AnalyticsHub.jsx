import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveReload } from '../live.js';
import Analytics from './Analytics.jsx';
import LibraryVisitTrends from './LibraryVisitTrends.jsx';

const number = new Intl.NumberFormat();

// Loads a small piece of data for a preview card and refreshes it on new attendance.
function usePreviewData(path) {
  const [state, setState] = useState({ data: null, error: false });
  const latest = useRef(0);
  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const data = await api(path);
      if (id === latest.current) setState({ data, error: false });
    } catch {
      if (id === latest.current) setState((s) => ({ ...s, error: true }));
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveReload(['attendance'], load);
  return state;
}

// ---- Miniature charts: no axes or labels, just the shape of the data ----

function MiniBars({ values }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mini-bars" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className={v === 0 ? 'is-zero' : ''} style={{ height: `${Math.max((v / max) * 100, v === 0 ? 3 : 6)}%` }} />
      ))}
    </div>
  );
}

function MiniLine({ values }) {
  const max = Math.max(...values, 1);
  const n = values.length;
  const pts = values.map((v, i) => [n === 1 ? 50 : (i / (n - 1)) * 100, 92 - (v / max) * 84]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `0,100 ${line} ${pts[pts.length - 1][0]},100`;
  return (
    <svg className="mini-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} className="mini-area" />
      <polyline points={line} className="mini-stroke" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ---- Preview content for each chart ----

function SummaryPreview() {
  const { data, error } = usePreviewData('/statistics/visits?range=last30');
  if (error && !data) return <p className="mini-note">Could not load.</p>;
  if (!data) return <p className="mini-note">Loading…</p>;
  return (
    <>
      <p className="mini-figure">
        <strong>{number.format(data.periodTotal)}</strong> {data.periodTotal === 1 ? 'visit' : 'visits'}
        <span className="muted"> in the last 30 days</span>
      </p>
      <MiniBars values={data.bars.map((b) => b.visits)} />
      <p className="mini-foot muted">
        Today {number.format(data.summary.today)} · This week {number.format(data.summary.thisWeek)}
      </p>
    </>
  );
}

function TrendsPreview() {
  const { data, error } = usePreviewData('/statistics/trends?report=monthly');
  if (error && !data) return <p className="mini-note">Could not load.</p>;
  if (!data) return <p className="mini-note">Loading…</p>;
  const shown = data.buckets.filter((b) => !b.future);
  return (
    <>
      <p className="mini-figure">
        <strong>{number.format(data.total)}</strong> {data.total === 1 ? 'visit' : 'visits'}
        <span className="muted"> in {data.label}</span>
      </p>
      <MiniLine values={shown.length ? shown.map((b) => b.visits) : [0]} />
      <p className="mini-foot muted">Monthly visits this year</p>
    </>
  );
}

// ---- Registry: adding a chart later means adding one entry here ----
// Entries without Preview/Detail are shown as "coming soon" placeholders.
const CHARTS = [
  { id: 'summary', title: 'Library Visit Summary', blurb: 'Daily visits and key totals', Preview: SummaryPreview, Detail: Analytics },
  { id: 'trends', title: 'Library Visit Trends', blurb: 'Daily, monthly and yearly trends', Preview: TrendsPreview, Detail: LibraryVisitTrends },
  { id: 'soon-1', title: 'More analytics', blurb: 'A new chart will appear here' },
  { id: 'soon-2', title: 'More analytics', blurb: 'A new chart will appear here' },
  { id: 'soon-3', title: 'More analytics', blurb: 'A new chart will appear here' },
];

export default function AnalyticsHub() {
  const [params, setParams] = useSearchParams();
  const chart = CHARTS.find((c) => c.id === params.get('chart') && c.Detail) || null;
  const lastOpened = useRef(null);
  const detailRef = useRef(null);

  const open = (id) => {
    lastOpened.current = id;
    setParams({ view: 'analytics', chart: id });
  };
  const back = () => setParams({ view: 'analytics' });

  // Keyboard users land on the detail view, or back on the card they opened.
  useEffect(() => {
    if (chart) {
      detailRef.current?.focus();
      window.scrollTo({ top: 0 });
    } else if (lastOpened.current) {
      document.getElementById(`chart-card-${lastOpened.current}`)?.focus();
      lastOpened.current = null;
    }
  }, [chart]);

  if (chart) {
    const { Detail } = chart;
    return (
      <div className="analytics-detail">
        <div className="detail-bar">
          <button type="button" className="btn btn-quiet back-btn" onClick={back}>
            <span aria-hidden="true">←</span> All charts
          </button>
          <p className="muted" ref={detailRef} tabIndex={-1} role="status">
            Viewing: {chart.title}
          </p>
        </div>
        <Detail />
      </div>
    );
  }

  return (
    <ul className="chart-cards" aria-label="Analytics charts">
      {CHARTS.map((c) => (
        <li key={c.id}>
          {c.Preview ? (
            <button id={`chart-card-${c.id}`} type="button" className="chart-card" onClick={() => open(c.id)}>
              <span className="chart-card-head">
                <span className="chart-card-title">{c.title}</span>
                <span className="chart-card-open">
                  View details <span aria-hidden="true">→</span>
                </span>
              </span>
              <span className="chart-card-body">
                <c.Preview />
              </span>
            </button>
          ) : (
            <div className="chart-card is-soon" aria-label={`${c.title}: coming soon`}>
              <span className="chart-card-head">
                <span className="chart-card-title">{c.title}</span>
                <span className="soon-badge">Coming soon</span>
              </span>
              <span className="chart-card-body soon-body">
                <span aria-hidden="true" className="soon-shape" />
                <span className="muted">{c.blurb}</span>
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
