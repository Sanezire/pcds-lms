import { useEffect, useRef } from 'react';

// One shared server-sent events connection for the whole app. The server only
// announces which topic changed; each page then reloads its own data.

const listeners = new Map(); // topic -> Set(fn)
const openListeners = new Set();
let source = null;
let connected = false;
let retryTimer = null;
let subscribers = 0;

function connect() {
  if (source || subscribers === 0) return;
  source = new EventSource('/api/events', { withCredentials: true });
  source.onopen = () => {
    connected = true;
    openListeners.forEach((fn) => fn());
  };
  source.addEventListener('refresh', (e) => {
    listeners.get(e.data)?.forEach((fn) => fn());
  });
  source.onerror = () => {
    connected = false;
    // The browser retries dropped streams by itself. A closed stream means the
    // server refused it (for example the session ended), so try again later.
    if (source && source.readyState === EventSource.CLOSED) {
      source.close();
      source = null;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 5000);
    }
  };
}

function disconnect() {
  clearTimeout(retryTimer);
  source?.close();
  source = null;
  connected = false;
}

function subscribe(topic, onChange, onOpen) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(onChange);
  openListeners.add(onOpen);
  subscribers += 1;
  connect();
  return () => {
    listeners.get(topic)?.delete(onChange);
    openListeners.delete(onOpen);
    subscribers -= 1;
    if (subscribers === 0) disconnect();
  };
}

// Runs `load` now, then again whenever one of `topics` changes on the server.
// It also reloads when the stream reconnects, when the tab becomes visible
// again or the device comes back online, and polls every 15 seconds while the
// live stream is down, so the page never stays stale.
export function useLiveData(topics, load) {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const key = topics.join(',');

  useEffect(() => {
    let timer = null;
    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadRef.current(), 150);
    };

    loadRef.current();

    const unsubscribers = key.split(',').map((topic) => subscribe(topic, run, run));
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', run);
    const poll = setInterval(() => {
      if (!connected) loadRef.current();
    }, 15000);

    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', run);
      unsubscribers.forEach((off) => off());
    };
  }, [key]);
}
