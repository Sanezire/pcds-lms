import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, kioskKey } from '../api.js';
import { useLiveReload } from '../live.js';
import { showWelcomeToast } from '../toast.js';
import '../kiosk.css';

const LOGO_SRC = '/images/pcds_logo.png';

const SUCCESS_MS = 5000; // how long a successful result stays on screen
const ERROR_MS = 4000; // how long an error stays on screen
const KEY_GAP_MS = 250; // card readers type fast; a longer pause starts a new scan
const SUBMIT_IDLE_MS = 150; // a scan is sent once typing stops this long, so Enter is optional
const MIN_ID_LENGTH = 3;
const MAX_ID_LENGTH = 32;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEALTH_MS = 10000;
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

// Message pop-up. Closes on its own after 5 seconds, or sooner with Proceed.
function KioskMessage({ text, onProceed }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    buttonRef.current?.focus();
    const timer = setTimeout(onProceed, MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [onProceed]);

  return (
    <div className="kiosk-overlay">
      <div className="kiosk-message" role="dialog" aria-modal="true" aria-labelledby="kiosk-message-title">
        <h2 id="kiosk-message-title" className="kiosk-message-title">
          Message
        </h2>
        <p className="kiosk-message-text">{text}</p>
        <div className="kiosk-message-bar" aria-hidden="true">
          <span style={{ animationDuration: `${MESSAGE_MS}ms` }} />
        </div>
        <button ref={buttonRef} type="button" className="kiosk-message-btn" onClick={onProceed}>
          Proceed
        </button>
      </div>
    </div>
  );
}

// Message kept on screen by staff. No Proceed button and no countdown: it
// stays until staff switch it off on the dashboard, and edits show up as typed.
function KioskPinnedMessage({ text }) {
  return (
    <div className="kiosk-overlay">
      <div className="kiosk-message" role="dialog" aria-modal="true" aria-labelledby="kiosk-pinned-title">
        <h2 id="kiosk-pinned-title" className="kiosk-message-title">
          Message
        </h2>
        <p className="kiosk-message-text">{text}</p>
      </div>
    </div>
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
  const [online, setOnline] = useState(true);
  const [focused, setFocused] = useState(() => document.hasFocus());

  const [messages, setMessages] = useState([]); // pop-ups waiting to be shown, first one is on screen
  const [pinned, setPinned] = useState(null); // text of the message kept on screen, or null

  const busyRef = useRef(false);
  const clearTimer = useRef(null);
  const modalOpenRef = useRef(false);

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
    (text) => {
      setResult(null);
      setMessage(text);
      setPhase('error');
      scheduleClear(ERROR_MS);
    },
    [scheduleClear]
  );

  const submitScan = useCallback(
    async (code) => {
      // Taps are ignored while a message pop-up is on screen.
      if (busyRef.current || modalOpenRef.current) return;
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
        // Welcome notice with the student's ID (from the account, not the card
        // number). An ID with its own message shows that instead of the welcome line.
        showWelcomeToast(data.attendance.studentId, data.message);
        scheduleClear(SUCCESS_MS);
      } catch (err) {
        showError(errorMessage(err));
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
      if (modalOpenRef.current) {
        buffer = '';
        return;
      }

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

  const currentMessage = messages[0] || null;
  const proceed = useCallback(() => setMessages((q) => q.slice(1)), []);

  useEffect(() => {
    // A kept message hides everything else, so taps are ignored while it is up.
    modalOpenRef.current = Boolean(currentMessage || pinned !== null);
  }, [currentMessage, pinned]);

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

  // Reader status. A keyboard-style reader cannot report its own connection,
  // so "ready" means the server is reachable and this screen can receive scans.
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    ping();
    const id = setInterval(ping, HEALTH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

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

  useEffect(() => () => clearTimeout(clearTimer.current), []);

  let reader = { tone: 'ok', title: 'Reader Ready', note: 'Waiting for the next student…' };
  if (!online) {
    reader = { tone: 'bad', title: 'Reader Offline', note: 'Cannot reach the server.' };
  } else if (!focused) {
    reader = { tone: 'warn', title: 'Reader Inactive', note: 'Tap anywhere on the screen to activate.' };
  }

  return (
    <div className="kiosk">
      <header className="kiosk-top">
        <div className="kiosk-brand">
          <img src={LOGO_SRC} alt="" width="52" height="52" />
          <div className="kiosk-brand-text">
            <span className="kiosk-brand-name">PCDS RFID Kiosk</span>
            <span className="kiosk-brand-sub">Polytechnic College of Davao del Sur</span>
          </div>
        </div>
        <LiveClock />
      </header>

      <main className="kiosk-main">
        <img className="kiosk-logo" src={LOGO_SRC} alt="Polytechnic College of Davao del Sur seal" />
        <h1 className="kiosk-title">Library Attendance</h1>
        <p className="kiosk-instruction">Please tap your RFID card on the reader.</p>

        <section className={`kiosk-card is-${phase}`} aria-live="polite" aria-atomic="true">
          {phase === 'idle' && (
            <div className="kiosk-state">
              <span className="kiosk-badge is-neutral">
                <Icon name="card" />
              </span>
              <p className="kiosk-state-title">Ready to scan</p>
              <p className="kiosk-state-note">Your Student ID will appear here after you tap.</p>
            </div>
          )}

          {phase === 'busy' && (
            <div className="kiosk-state">
              <span className="kiosk-spinner" aria-hidden="true" />
              <p className="kiosk-state-title">Checking your card…</p>
            </div>
          )}

          {phase === 'success' && result && (
            <div className="kiosk-result">
              <div className="kiosk-result-head">
                <span className="kiosk-badge is-success">
                  <Icon name="check" />
                </span>
                <p className="kiosk-result-title">Attendance Recorded</p>
              </div>
              <div className="kiosk-result-id">
                <span className="kiosk-label">Student ID</span>
                <span className="kiosk-id">{result.studentId}</span>
              </div>
              <div className="kiosk-result-meta">
                <div>
                  <span className="kiosk-label">Status</span>
                  <span className="kiosk-value">{ACTION_LABEL[result.action] || ''}</span>
                </div>
                <div>
                  <span className="kiosk-label">Time</span>
                  <span className="kiosk-value">{timeFmt.format(new Date(result.recordedAt))}</span>
                </div>
              </div>
            </div>
          )}

          {phase === 'error' && (
            <div className="kiosk-state">
              <span className="kiosk-badge is-error">
                <Icon name="alert" />
              </span>
              <p className="kiosk-state-title is-error">Scan unsuccessful</p>
              <p className="kiosk-state-note">{message}</p>
            </div>
          )}
        </section>
      </main>

      {pinned !== null ? (
        <KioskPinnedMessage text={pinned} />
      ) : (
        currentMessage && <KioskMessage key={currentMessage.key} text={currentMessage.text} onProceed={proceed} />
      )}

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
