import { authFetch } from './authApi';

export async function getSiteCustomization() {
  const res = await fetch('/api/site-customization', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`HTTP_${res.status}`);
  }
  return res.json();
}

export async function saveSiteCustomization(customization) {
  const res = await authFetch('/api/site-customization', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customization }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || `HTTP_${res.status}`);
  }

  return payload;
}