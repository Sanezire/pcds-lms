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
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(message, res.status, data?.error?.fields);
  }
  return data;
}

// Fetches a file (CSV, PDF) with the session cookie and returns it as a Blob.
export async function download(path) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'pcds-lms' },
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
