import { useId, useState } from 'react';
import { download } from '../api.js';
import { DownloadIcon } from './Icons.jsx';
import { showSuccessToast } from '../toast.js';

const pad = (n) => String(n).padStart(2, '0');
const NOW = new Date();
const THIS_YEAR = NOW.getFullYear();
const THIS_MONTH = `${THIS_YEAR}-${pad(NOW.getMonth() + 1)}`;
const YEARS = Array.from({ length: 10 }, (_, i) => THIS_YEAR - i);

// The start and end of the chosen month or year on this computer's clock, so the
// report covers the calendar period the person expects.
function rangeFor(period, month, year) {
  let from;
  let to;
  if (period === 'month') {
    const [y, m] = month.split('-').map(Number);
    from = new Date(y, m - 1, 1);
    to = new Date(y, m, 1);
  } else {
    from = new Date(year, 0, 1);
    to = new Date(year + 1, 0, 1);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Administrators only: downloads every visit in a month or a year as CSV or PDF.
export default function ExportPanel() {
  const periodId = useId();
  const monthId = useId();
  const yearId = useId();
  const [period, setPeriod] = useState('month');
  const [month, setMonth] = useState(THIS_MONTH);
  const [year, setYear] = useState(THIS_YEAR);
  const [busy, setBusy] = useState(null); // 'csv' | 'pdf' | null
  const [error, setError] = useState('');

  const valid = period === 'month' ? /^\d{4}-\d{2}$/.test(month) && month <= THIS_MONTH : Number.isInteger(year);

  async function run(format) {
    if (!valid) return;
    setBusy(format);
    setError('');
    try {
      const { from, to } = rangeFor(period, month, year);
      const params = new URLSearchParams({
        format,
        period,
        from,
        to,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      const { blob, filename } = await download(`/export/attendance?${params}`);
      saveBlob(blob, filename);
      showSuccessToast('Export ready', filename);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel export-panel" aria-labelledby="export-h">
      <div>
        <h2 id="export-h">Export attendance</h2>
        <p className="muted">
          Download every visit, RFID and manual, for a month or a year. Times use this computer&rsquo;s time zone.
        </p>
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="export-controls">
        <div className="filter">
          <label htmlFor={periodId}>Period</label>
          <select id={periodId} className="field-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
        </div>

        {period === 'month' ? (
          <div className="filter">
            <label htmlFor={monthId}>Month</label>
            <input
              id={monthId}
              type="month"
              className="field-select"
              value={month}
              max={THIS_MONTH}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        ) : (
          <div className="filter">
            <label htmlFor={yearId}>Year</label>
            <select id={yearId} className="field-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="export-actions">
          <button type="button" className="btn btn-quiet btn-lg" onClick={() => run('csv')} disabled={!valid || Boolean(busy)}>
            <DownloadIcon width={18} height={18} />
            {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
          </button>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => run('pdf')} disabled={!valid || Boolean(busy)}>
            <DownloadIcon width={18} height={18} />
            {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </section>
  );
}
