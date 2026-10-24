const CACHE = 'dump-static-v1';
const MAX_ENTRIES = 60;
let writes = Promise.resolve();

function store(key, response) {
  const task = writes.then(async () => {
    const cache = await caches.open(CACHE);
    await cache.put(key, response);
    const keys = await cache.keys();
    for (const oldest of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) await cache.delete(oldest);
  });
  writes = task.catch(() => {});
  return writes;
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

async function navigation(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) await store('/', response.clone());
    return response;
  } catch {
    return await (await caches.open(CACHE)).match('/') ?? new Response('You are offline. Open Dump online once to cache the app shell.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } finally { clearTimeout(timeout); }
}
async function staticAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.status === 200) await store(request, response.clone());
  return response;
}
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.headers.has('Range')) return;
  if (request.mode === 'navigate') event.respondWith(navigation(request));
  else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') event.respondWith(staticAsset(request));
});
