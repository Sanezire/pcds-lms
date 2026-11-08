export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

// The kiosk screen has no sign-in. If the server is set up with a kiosk key,
// open /kiosk?key=... once on the kiosk device and it is remembered here.
const KIOSK_KEY_STORAGE = 'pcds_kiosk_key';
export const kioskKey = {
  get() {
    try {
      return localStorage.getItem(KIOSK_KEY_STORAGE) || '';
    } catch {
      return '';
    }
  },
  set(value) {
    try {
      localStorage.setItem(KIOSK_KEY_STORAGE, value);
    } catch {
      /* storage blocked: the key stays in the address bar for this visit only */
    }
  },
};

// The last answer of each statistics/dashboard request, kept in memory for this
// browser tab, so going back to a screen shows it at once while a fresh copy
// loads quietly. Forgotten on sign-out or when the session ends.
const CACHED = /^\/(statistics|dashboard)\//;
const lastAnswers = new Map();
export const cachedAnswer = (path) => lastAnswers.get(path);
export const clearCachedAnswers = () => lastAnswers.clear();

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: {
        'X-Requested-With': 'pcds-lms',
        ...(path.startsWith('/kiosk') && kioskKey.get() ? { 'X-Kiosk-Key': kioskKey.get() } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty or non-JSON body */
  }

  if (!res.ok) {
    const message = data?.error?.message || 'Something went wrong. Try again.';
    // A 401 on any call other than sign-in means the session ended.
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      clearCachedAnswers();
      onUnauthorized();
    }
    throw new ApiError(message, res.status, data?.error?.fields);
  }
  if (method === 'GET' && CACHED.test(path)) {
    lastAnswers.delete(path);
    lastAnswers.set(path, data);
    if (lastAnswers.size > 100) lastAnswers.delete(lastAnswers.keys().next().value);
  }
  return data;
}

// Fetches a file (CSV, PDF) with the session cookie and returns it as a Blob.
export async function download(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'include',
      headers: { 'X-Requested-With': 'pcds-lms', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }

  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (res.status === 401) onUnauthorized();
    throw new ApiError(data?.error?.message || 'Something went wrong. Try again.', res.status);
  }

  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
  return { blob: await res.blob(), filename: match ? match[1] : 'attendance-export' };
}
