import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useLiveData } from '../live.js';
import '../live.css';

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export default function LiveStats() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const clockOffset = useRef(0); // server time minus this device's time
  const rolledFor = useRef('');

  const load = useCallback(async () => {
    try {
      const data = await api('/attendance/stats');
      clockOffset.current = new Date(data.stats.serverTime).getTime() - Date.now();
      setStats(data.stats);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useLiveData(['attendance'], load);

  // Ticks every second so the running total moves without any request.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    return () => clearInterval(id);
  }, []);

  // A new attendance day starts at local midnight: reload once when it does.
  useEffect(() => {
    if (stats && now >= Date.parse(stats.dayEndsAt) && rolledFor.current !== stats.dayEndsAt) {
      rolledFor.current = stats.dayEndsAt;
      load();
    }
  }, [now, stats, load]);

  const running = stats
    ? stats.completedSeconds +
      stats.openSince.reduce((sum, iso) => sum + Math.max(0, (now - Date.parse(iso)) / 1000), 0)
    : 0;

  return (
    <section className="panel" aria-labelledby="stats-h">
      <h2 id="stats-h">Library today</h2>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {!stats && !error && <p className="muted">Loading statistics…</p>}

      {stats && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">In the library now</span>
            <span className="stat-value">{stats.currentlyIn}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Check-ins today</span>
            <span className="stat-value">{stats.checkInsToday}</span>
            <span className="stat-note">{stats.visitorsToday} different students</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total time today</span>
            <span className="stat-value" role="timer" aria-live="off">
              {formatDuration(running)}
            </span>
            <span className="stat-note">Hours : minutes : seconds</span>
          </div>
        </div>
      )}
    </section>
  );
}
