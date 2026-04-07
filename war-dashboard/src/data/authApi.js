const ACCESS_TOKEN_KEY = 'wp_access_token';

function readAccessToken() {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY) || '';
}

function writeAccessToken(token) {
  if (!token) {
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error || `HTTP_${res.status}`;
    const err = new Error(message);
    err.code = message;
    err.status = res.status;
    throw err;
  }

  return payload;
}

export async function signUp({ email, password, displayName }) {
  const payload = await request('/api/auth/signup', {
    method: 'POST',
    body: {
      email,
      password,
      display_name: displayName,
    },
  });
  writeAccessToken(payload?.access_token || '');
  return payload?.user || null;
}

export async function signIn({ email, password }) {
  const payload = await request('/api/auth/signin', {
    method: 'POST',
    body: { email, password },
  });
  writeAccessToken(payload?.access_token || '');
  return payload?.user || null;
}

export async function refreshSession() {
  const payload = await request('/api/auth/refresh', {
    method: 'POST',
  });
  writeAccessToken(payload?.access_token || '');
  return payload?.user || null;
}

export async function getCurrentUser() {
  let token = readAccessToken();
  if (!token) {
    try {
      const user = await refreshSession();
      token = readAccessToken();
      if (!token) return user;
    } catch (_err) {
      return null;
    }
  }

  try {
    const payload = await request('/api/auth/me', {
      method: 'GET',
      token,
    });
    return payload?.user || null;
  } catch (err) {
    if (err.status === 401) {
      try {
        const user = await refreshSession();
        const nextToken = readAccessToken();
        if (!nextToken) return user;
        const payload = await request('/api/auth/me', { method: 'GET', token: nextToken });
        return payload?.user || null;
      } catch (_refreshErr) {
        writeAccessToken('');
        return null;
      }
    }
    throw err;
  }
}

export async function signOut() {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } finally {
    writeAccessToken('');
  }
}
