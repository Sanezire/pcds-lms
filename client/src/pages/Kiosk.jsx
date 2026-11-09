import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, kioskKey } from '../api.js';
import { useLiveReload } from '../live.js';
import { WELCOME_TEXT, GOODBYE_TEXT } from '../toast.js';
import '../kiosk.css';

const LOGO_SRC = '/images/pcds_logo.png';

const TOAST_MS = 5000; // how long each scan notice stays
const MAX_TOASTS = 5; // more than this at once and the oldest notice is dropped (first in, first out)
const SUCCESS_MS = 5000; // how long a successful result stays on screen
const ERROR_MS = 4000; // how long an error stays on screen
const KEY_GAP_MS = 250; // card readers type fast; a longer pause starts a new scan
const SUBMIT_IDLE_MS = 150; // a scan is sent once typing stops this long, so Enter is optional
const MIN_ID_LENGTH = 3;
const MAX_ID_LENGTH = 32;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MESSAGE_MS = 5000; // a message pop-up closes by itself after this long
const MESSAGE_POLL_MS = 3000; // how often the kiosk checks for messages sent from the dashboard

const ACTION_LABEL = { in: 'Time In', out: 'Time Out' };

// Fixed, generic wording. Server messages are never shown on this screen.
const MSG_FAILED = 'We could not record your attendance. Please tap again or ask library staff for help.';
const MSG_OFFLINE = 'The system is unavailable right now. Please ask library staff for help.';
const MSG_BUSY = 'Too many taps in a row. Please wait a moment and try again.';

const dateFmt = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const timeFmt = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });

function errorMessage(err) {
  if (err instanceof ApiError) {
    if (err.status === 0) return MSG_OFFLINE;
    if (err.status === 429) return MSG_BUSY;
  }
  return MSG_FAILED;
}

// Taps are refused outside library hours (set by the super admin in Settings).
const closedHours = (err) => (err instanceof ApiError && err.status === 403 && err.fields?.libraryClosed) || null;

function Icon({ name }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  if (name === 'check') {
    return (
      <svg {...common}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  }
  if (name === 'alert') {
    return (
      <svg {...common}>
        <path d="M12 7v6M12 17h.01" />
      </svg>
    );
  }
  // card / signal
  return (
    <svg {...common}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M8 12h5M8 15h3" />
    </svg>
  );
}

// One scan notice. It removes itself after TOAST_MS.
function ScanToast({ id, title, text, onGone }) {
  useEffect(() => {
    const timer = setTimeout(() => onGone(id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [id, onGone]);
  return (
    <li className="kiosk-toast">
      <span className="kiosk-toast-icon">
        <Icon name="check" />
      </span>
      <span className="kiosk-toast-body">
        <span className="kiosk-toast-title">{title}</span>
        <span className="kiosk-toast-text">{text}</span>
      </span>
    </li>
  );
}

// Message box above the tap instruction. While it shows it replaces the
// "Library Attendance" title, which comes back when the message is removed. A message sent from the dashboard
// shows for 5 seconds and then goes away by itself; a kept message stays
// until staff switch it off. It is not
// an overlay, so cards can still be tapped while it is showing.
function KioskNotice({ text, onDone }) {
  useEffect(() => {
    if (!onDone) return undefined;
    const timer = setTimeout(onDone, MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <section className="kiosk-message" role="status" aria-live="polite" aria-atomic="true">
      <h2 className="kiosk-message-title">Message</h2>
      <p className="kiosk-message-text">{text}</p>
    </section>
  );
}

// Own component so the once-a-second tick does not re-render the whole screen.
const LiveClock = memo(function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="kiosk-clock">
      <span className="kiosk-date">{dateFmt.format(now)}</span>
      <span className="kiosk-time">{timeFmt.format(now)}</span>
    </div>
  );
});

// If the server uses a kiosk key, the kiosk device is set up once by opening
// /kiosk?key=... The key is remembered and removed from the address bar.
function captureKioskKey() {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('key');
  if (!key) return;
  kioskKey.set(key.trim());
  params.delete('key');
  const rest = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
}

export default function Kiosk() {
  useMemo(captureKioskKey, []);
  const [phase, setPhase] = useState('idle'); // idle | busy | success | error
  const [result, setResult] = useState(null); // { studentId, action, recordedAt }
  const [message, setMessage] = useState('');
  const [errorTitle, setErrorTitle] = useState('Scan unsuccessful');
  const [library, setLibrary] = useState(null); // { open, hours } from the server
  const [focused, setFocused] = useState(() => document.hasFocus());

  const [messages, setMessages] = useState([]); // pop-ups waiting to be shown, first one is on screen
  const [pinned, setPinned] = useState(null); // text of the message kept on screen, or null

  const busyRef = useRef(false);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);
  const removeToast = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const clearTimer = useRef(null);

  const backToReady = useCallback(() => {
    setPhase('idle');
    setResult(null);
    setMessage('');
  }, []);

  const scheduleClear = useCallback(
    (ms) => {
      clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(backToReady, ms);
    },
    [backToReady]
  );

  const showError = useCallback(
    (text, title = 'Scan unsuccessful') => {
      setResult(null);
      setErrorTitle(title);
      setMessage(text);
      setPhase('error');
      scheduleClear(ERROR_MS);
    },
    [scheduleClear]
  );

  const submitScan = useCallback(
    async (code) => {
      if (busyRef.current) return;
      clearTimeout(clearTimer.current);

      if (code.length < MIN_ID_LENGTH || code.length > MAX_ID_LENGTH || !ID_PATTERN.test(code)) {
        showError(MSG_FAILED);
        return;
      }

      busyRef.current = true;
      setResult(null);
      setPhase('busy');
      try {
        const data = await api('/kiosk/scan', { method: 'POST', body: { studentId: code } });
        setResult(data.attendance);
        setPhase('success');
        // Welcome (Time In) or goodbye (Time Out) notice with the student's ID (from the account, not the card
        // number). An ID with its own message shows that instead of the welcome line.
        const line = data.message || (data.attendance.action === 'out' ? GOODBYE_TEXT : WELCOME_TEXT);
        toastId.current += 1;
        const toast = { id: toastId.current, title: line, text: data.attendance.studentId };
        // Newest goes last; when over the limit the oldest are dropped from the top.
        setToasts((list) => [...list, toast].slice(-MAX_TOASTS));
        scheduleClear(SUCCESS_MS);
      } catch (err) {
        const hours = closedHours(err);
        if (hours) {
          setLibrary((l) => ({ ...l, open: false, hours }));
          showError(`Attendance is only recorded during library hours: ${hours}.`, 'The library is closed');
        } else showError(errorMessage(err));
      } finally {
        busyRef.current = false;
      }
    },
    [scheduleClear, showError]
  );

  // RFID reader input. USB readers act like a keyboard: they type the card
  // value very quickly. The scan is sent when Enter arrives, or when typing
  // stops for a moment, so readers that do not send Enter work too. Slow,
  // stray typing is ignored.
  useEffect(() => {
    let buffer = '';
    let lastKeyAt = 0;
    let idleTimer;

    const flush = () => {
      const code = buffer.trim();
      buffer = '';
      if (code.length >= MIN_ID_LENGTH) submitScan(code);
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      if (now - lastKeyAt > KEY_GAP_MS) buffer = '';
      lastKeyAt = now;

      if (e.key === 'Enter') {
        clearTimeout(idleTimer);
        const code = buffer.trim();
        buffer = '';
        if (code) {
          e.preventDefault();
          submitScan(code);
        }
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        if (buffer.length <= MAX_ID_LENGTH) buffer += e.key;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(flush, SUBMIT_IDLE_MS);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [submitScan]);

  // Whether the library is open. Reloaded the moment the super admin changes the
  // hours (live update) and right at the next opening or closing time, so the
  // screen never needs a refresh.
  const loadLibrary = useCallback(
    () =>
      api('/kiosk/status')
        .then((data) => setLibrary({ open: data.open, hours: data.hours, nextChangeAt: data.nextChangeAt }))
        .catch(() => {}),
    []
  );
  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);
  useLiveReload(['library'], loadLibrary);
  useEffect(() => {
    if (!library?.nextChangeAt) return undefined;
    // A second late, so the server already sees the new state. Long waits are
    // re-checked hourly in case the computer's clock or sleep shifts the timer.
    const wait = Math.max(new Date(library.nextChangeAt).getTime() - Date.now() + 1000, 1000);
    const timer = setTimeout(loadLibrary, Math.min(wait, 60 * 60 * 1000));
    return () => clearTimeout(timer);
  }, [library, loadLibrary]);

  const currentMessage = messages[0] || null;
  const proceed = useCallback(() => setMessages((q) => q.slice(1)), []);

  // The kept message changes the moment staff edit or switch it off. The
  // 3-second poll below is the backup if the live connection drops.
  const loadPinned = useCallback(async () => {
    try {
      const data = await api('/kiosk/pinned');
      setPinned(data.pinned);
    } catch {
      /* offline: the status footer already shows that */
    }
  }, []);
  useLiveReload(['messages'], loadPinned);

  // Messages sent from the dashboard. The first call only learns the latest
  // message number, so opening the kiosk never replays old messages.
  useEffect(() => {
    let alive = true;
    let after = null;
    let timer;

    const poll = async () => {
      try {
        const data = await api(after === null ? '/kiosk/messages' : `/kiosk/messages?after=${after}`);
        if (!alive) return;
        after = data.latestId;
        if (data.pinned !== undefined) setPinned(data.pinned);
        if (data.messages.length) {
          setMessages((q) => [...q, ...data.messages.map((m) => ({ key: `sent-${m.id}`, text: m.text }))]);
        }
      } catch {
        // Offline: the status footer already shows that.
      }
      if (alive) timer = setTimeout(poll, MESSAGE_POLL_MS);
    };
    poll();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);
  const reader = focused
    ? { tone: 'ok', title: 'Reader Ready', note: 'Waiting for the next student…' }
    : { tone: 'warn', title: 'Reader Inactive', note: 'Tap anywhere on the screen to activate.' };

  return (
    <div className="kiosk">
      <header className="kiosk-top">
        <div className="kiosk-brand">
          <img src={LOGO_SRC} alt="" width="52" height="52" />
          <div className="kiosk-brand-text">
            <span className="kiosk-brand-name">PCDS LRC</span>
            <span className="kiosk-brand-sub">Polytechnic College of Davao del Sur</span>
          </div>
        </div>
        <LiveClock />
      </header>

      {/* Zero-height anchor right under the header, so the notices scroll with the page. */}
      <div className="kiosk-toasts" role="status" aria-live="polite">
        <ul>
          {toasts.map((t) => (
            <ScanToast key={t.id} id={t.id} title={t.title} text={t.text} onGone={removeToast} />
          ))}
        </ul>
      </div>

      <main className={`kiosk-main${phase === 'success' && result ? ' has-card' : ''}`}>
        <img className="kiosk-logo" src={LOGO_SRC} alt="Polytechnic College of Davao del Sur seal" />
        {/* A message takes the place of the title while it is showing, then the title returns. */}
        {currentMessage ? (
          <KioskNotice key={currentMessage.key} text={currentMessage.text} onDone={proceed} />
        ) : pinned !== null ? (
          <KioskNotice text={pinned} />
        ) : (
          <h1 className="kiosk-title">Library Attendance</h1>
        )}
        {phase === 'error' && <p className="kiosk-instruction">Please tap your RFID card on the reader.</p>}

        <section className={`kiosk-card is-${phase}`} aria-live="polite" aria-atomic="true">
          {phase === 'idle' && (
            <div className="kiosk-idstage is-empty" role="img" aria-label="Ready to scan. Your ID will appear here after you tap.">
              <div className="kiosk-holder">
                <span className="kiosk-holder-slot" aria-hidden="true" />
                <div className="kiosk-idcard is-wait">
                  {library && !library.open ? (
                    <>
                      <p className="kiosk-idcard-closed">The library is closed</p>
                      <p className="kiosk-idcard-prompt">Library hours: {library.hours}</p>
                    </>
                  ) : (
                    <>
                      <img className="kiosk-idcard-tap" src="/images/contactless_icon.gif" alt="" />
                      <p className="kiosk-idcard-prompt">Please tap your RFID card on the reader.</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {phase === 'busy' && (
            <div className="kiosk-idstage is-empty">
              <div className="kiosk-holder">
                <span className="kiosk-holder-slot" aria-hidden="true" />
                <div className="kiosk-idcard is-wait">
                  <span className="kiosk-spinner" aria-hidden="true" />
                  <p className="kiosk-idcard-wait">Checking your card…</p>
                </div>
              </div>
            </div>
          )}

          {phase === 'success' && result && (
            <div className="kiosk-idstage">
              <div className="kiosk-holder">
                <span className="kiosk-holder-slot" aria-hidden="true" />
                <div className="kiosk-idcard">
                  <div className="kiosk-idcard-head">
                    <p className="kiosk-idcard-school">
                      Polytechnic College
                      <br />
                      of Davao del Sur, Inc.
                    </p>
                    <span className="kiosk-idcard-seal">
                      <img src={LOGO_SRC} alt="" />
                    </span>
                  </div>
                  <div className="kiosk-idcard-body">
                    <p className="kiosk-idcard-action">{ACTION_LABEL[result.action] || ''}</p>
                    <img className="kiosk-idcard-photo" src={LOGO_SRC} alt="" />
                    <p className="kiosk-idcard-ok">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                      Attendance recorded
                    </p>
                    <p className="kiosk-idcard-time">{timeFmt.format(new Date(result.recordedAt))}</p>
                    <div className="kiosk-idcard-id">
                      <span className="kiosk-idcard-label">ID No.</span>
                      <span className="kiosk-idcard-num">{result.studentId}</span>
                    </div>
                  </div>
                  <div className="kiosk-idcard-foot">
                    <span>PCDS LRC</span>
                    <svg className="kiosk-idcard-nfc" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                      <path className="arc-1" d="M8 8.5c2 2.2 2 4.8 0 7" />
                      <path className="arc-2" d="M12 6c3.4 3.4 3.4 8.6 0 12" />
                      <path className="arc-3" d="M16 3.5c4.8 4.6 4.8 12.4 0 17" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="kiosk-state">
              <span className="kiosk-badge is-error">
                <Icon name="alert" />
              </span>
              <p className="kiosk-state-title is-error">{errorTitle}</p>
              <p className="kiosk-state-note">{message}</p>
            </div>
          )}
        </section>
      </main>

      <footer className="kiosk-foot">
        <span className={`kiosk-dot is-${reader.tone}`} aria-hidden="true" />
        <span className="kiosk-reader">
          <strong className={`is-${reader.tone}`}>{reader.title}</strong>
          <span>{reader.note}</span>
        </span>
      </footer>

    </div>
  );
}
