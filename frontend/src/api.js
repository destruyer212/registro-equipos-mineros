const origin = (import.meta.env.VITE_API_URL || 'http://localhost:4180').replace(/\/$/, '');
export const apiDocsUrl = `${origin}/docs/`;

async function request(path, { method = 'GET', body, signal } = {}) {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(`${origin}${path}`, {
    method,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  }).catch((error) => {
    if (signal?.aborted) throw error;
    throw new Error('No pudimos conectar con la API. Intenta de nuevo.');
  });
  if (response.status === 204) return;
  const result = await response.json().catch(() => {
    throw new Error('La API no pudo responder. Intenta de nuevo.');
  });
  if (!response.ok) throw new Error(result.error?.issues?.[0]?.message || result.error?.message || 'La API no está disponible.');
  return result.data;
}

const base = '/api/v1/equipment';
export const api = {
  list: (signal) => request(base, { signal }),
  types: (signal) => request('/api/v1/equipment-types', { signal }),
  history: (id, signal) => request(`${base}/${id}/maintenance`, { signal }),
  create: (body) => request(base, { method: 'POST', body }),
  update: (id, body) => request(`${base}/${id}`, { method: 'PATCH', body }),
  remove: (id) => request(`${base}/${id}`, { method: 'DELETE' }),
  maintain: (id, body) => request(`${base}/${id}/maintenance`, { method: 'POST', body }),
};
