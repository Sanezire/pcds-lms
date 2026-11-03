import { useEffect } from 'react';
import { showErrorToast, showSuccessToast } from '../toast.js';

const PERIOD_MS = 10_000;
const TIMEOUT_MS = 3_000;
let connectionLost = false;

export default function ServerConnectionMonitor() {
  useEffect(() => {
    let stopped = false;
    let timer;
    let controller;
    let checking = false;
    let paused = false;

    const schedule = (delay) => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === 'visible') timer = setTimeout(check, delay);
    };
    async function check() {
      if (stopped || checking || document.visibilityState !== 'visible') return;
      checking = true;
      controller = new AbortController();
      let timedOut = false;
      paused = false;
      const timeout = setTimeout(() => { timedOut = true; controller?.abort(); }, TIMEOUT_MS);
      let healthy = false;
      try {
        const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
        healthy = response.ok;
      } catch {
        healthy = false;
      } finally {
        clearTimeout(timeout);
        checking = false;
        controller = null;
      }
      if (paused && !timedOut) return;
      if (stopped || document.visibilityState !== 'visible') return;
      if (!healthy && !connectionLost) {
        connectionLost = true;
        showErrorToast('Library server connection lost', 'Attendance and other server requests may not be available.');
      } else if (healthy && connectionLost) {
        connectionLost = false;
        showSuccessToast('Library server connection restored');
      }
      schedule(PERIOD_MS);
    }
    const visibility = () => {
      if (document.visibilityState === 'visible') check();
      else {
        clearTimeout(timer);
        if (checking) paused = true;
        controller?.abort();
      }
    };
    document.addEventListener('visibilitychange', visibility);
    if (document.visibilityState === 'visible') check();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  return null;
}
