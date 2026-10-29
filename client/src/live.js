import { useEffect, useRef, useState } from 'react';
import { kioskKey } from './api.js';

// One shared Server-Sent Events connection for the whole app. The server
// announces which topic changed; screens subscribe to the topics they show.
const listeners = new Set();
let source = null;

function connect() {
  if (source) return;
  // The kiosk screen has no sign-in, so it listens on its own public stream.
  const onKiosk = window.location.pathname.startsWith('/kiosk');
  const key = onKiosk ? kioskKey.get() : '';
  const url = onKiosk ? `/api/kiosk/events${key ? `?key=${encodeURIComponent(key)}` : ''}` : '/api/events';
  source = new EventSource(url, { withCredentials: true });
  const notify = (topic) => listeners.forEach((fn) => fn(topic));
  source.addEventListener('change', (e) => {
    try {
      notify(JSON.parse(e.data).topic);
    } catch {
      notify('*');
    }
  });
  // The browser reconnects by itself after a drop. Anything missed while the
  // connection was down is picked up by reloading once it is back.
  source.addEventListener('ready', () => notify('*'));
}

function subscribe(fn) {
  listeners.add(fn);
  connect();
  return () => {
    listeners.delete(fn);
    if (!listeners.size && source) {
      source.close();
      source = null;
    }
  };
}

const COALESCE_MS = 150;

// Calls `reload` whenever one of `topics` changes, when the tab becomes visible
// again, and every `fallbackMs` as a safety net (for example if a proxy
// buffers the live stream).
export function useLiveReload(topics, reload, fallbackMs = 30000) {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const key = topics.join(',');

  useEffect(() => {
    const wanted = new Set(key.split(','));
    let timer;
    const trigger = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reloadRef.current(), COALESCE_MS);
    };
    const unsubscribe = subscribe((topic) => {
      if (topic === '*' || wanted.has(topic)) trigger();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') trigger();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', trigger);
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') trigger();
    }, fallbackMs);

    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', trigger);
    };
  }, [key, fallbackMs]);
}

// Current time that re-renders every `ms`, so running timers ("3m so far")
// keep counting without any request. `offsetMs` corrects for a device clock
// that differs from the server's.
export function useNow(ms = 10000, offsetMs = 0) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now + offsetMs;
}
