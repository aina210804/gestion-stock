export async function api(path, { method = 'GET', body = null, raw = false } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.redirected) {
    location.href = res.url;
    throw new Error('Redirection');
  }
  if (!res.ok) {
    if (res.status === 401) {
      location.href = '/';
      throw new Error('Session expirée');
    }
    let message = `Erreur ${res.status}`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch (e) { /* corps non JSON */ }
    throw new Error(message);
  }
  if (raw) return res;
  return res.json();
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });
export const put = (path, body = {}) => api(path, { method: 'PUT', body });
export const del = (path) => api(path, { method: 'DELETE' });

export async function download(path, filename) {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
