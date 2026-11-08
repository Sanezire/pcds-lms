import { config } from './config.js';

// Remembers the answers of the heavy read-only endpoints (statistics, dashboard
// summary), so opening a screen again is instant. Everything is forgotten as soon
// as attendance changes (see publish() in events.js), when the school day changes,
// and after MAX_AGE_MS as a safety net for changes made directly in the database.
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 300;
const OFFSET_MIN = Math.trunc(config.attendance.utcOffsetMinutes);

const store = new Map();
let generation = 0;

export function clearResponseCache() {
  generation += 1;
  store.clear();
}

const today = () => new Date(Date.now() + OFFSET_MIN * 60 * 1000).toISOString().slice(0, 10);

// Use after the sign-in and role checks of a router. Only successful GET answers
// are kept; the key is the full address, so each filter combination is separate.
export function cacheResponses({ except = [] } = {}) {
  return (req, res, next) => {
    if (req.method !== 'GET' || except.includes(req.path)) return next();
    const key = `${today()} ${req.baseUrl}${req.url}`;
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < MAX_AGE_MS) {
      res.set('Cache-Control', 'no-store');
      return res.json(hit.body);
    }

    const started = generation;
    const send = res.json.bind(res);
    res.json = (body) => {
      // Not kept if attendance changed while this answer was being worked out.
      if (res.statusCode === 200 && started === generation) {
        store.delete(key);
        store.set(key, { at: Date.now(), body });
        if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
      }
      return send(body);
    };
    next();
  };
}
