const { version, files } = __PRECACHE__;
const prefix = 'minacontrol-shell-';
const cacheName = prefix + version;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) =>
    cache.addAll(files.map((file) => new Request(file, { cache: 'reload' }))),
  ));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { signal: AbortSignal.timeout(4500) });
        if (response.ok) return response;
      } catch {
        // Open the matching app shell when the network is unavailable.
      }
      return (await caches.open(cacheName)).match('/');
    })());
  } else if (files.includes(url.pathname) && url.pathname !== '/') {
    event.respondWith((async () => {
      const cached = await (await caches.open(cacheName)).match(event.request);
      return cached || fetch(event.request);
    })());
  }
});
