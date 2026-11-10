const origin = (import.meta.env.VITE_API_URL || 'http://localhost:4180').replace(/\/$/, '');
export const apiDocsUrl = `${origin}/docs/`;
export const usesRender = new URL(origin, window.location.origin).hostname.endsWith('.onrender.com');

export class ApiUnavailableError extends Error {}

async function request(path, { method = 'GET', body, signal } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(cancel, 10_000);
  let response;
  let result;
  try {
    response = await fetch(`${origin}${path}`, {
      method,
      signal: controller.signal,
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });
    if (response.status === 204) return;
    result = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiUnavailableError('No pudimos conectar con la API. Intenta de nuevo.', { cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
  if (response.status >= 500) throw new ApiUnavailableError('La API está temporalmente fuera de servicio.');
  if (!response.ok) throw new Error(result.error?.issues?.[0]?.message || result.error?.message || 'La API no está disponible.');
  return result.data;
}

const base = '/api/v1/equipment';

export async function loadInventory(signal, waitForStartup) {
  const deadline = Date.now() + 85_000;
  while (true) {
    try {
      return await Promise.all([request(base, { signal }), request('/api/v1/equipment-types', { signal })]);
    } catch (error) {
      if (!usesRender || !waitForStartup || signal.aborted ||
          !(error instanceof ApiUnavailableError) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 3000));
      if (signal.aborted) throw error;
    }
  }
}

export const api = {
  history: (id, signal) => request(`${base}/${id}/maintenance`, { signal }),
  create: (body) => request(base, { method: 'POST', body }),
  update: (id, body) => request(`${base}/${id}`, { method: 'PATCH', body }),
  remove: (id) => request(`${base}/${id}`, { method: 'DELETE' }),
  maintain: (id, body) => request(`${base}/${id}/maintenance`, { method: 'POST', body }),
};
