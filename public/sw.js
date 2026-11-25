// Service worker: la web se puede abrir sin conexión y consultar lo último que se vio.
//   - Páginas, JS, CSS e imágenes propias: se sirven de la caché y se actualizan en segundo plano.
//   - Datos de tu cuenta (/api/collection, /api/decks, /api/wishlist...): primero la red; sin conexión, lo último guardado.
//     Esa caché se borra al cerrar sesión (session.js), para no dejar datos en un equipo compartido.
//   - Inicio de sesión (/api/auth/*) y cualquier escritura: nunca pasan por la caché.
const STATIC = 'tcg-static-v1';
const API = 'tcg-api-v1';
const API_PATHS = ['/api/collection', '/api/decks', '/api/wishlist', '/api/games', '/api/banlists', '/api/shared-deck'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== API).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (hit) {
    fresh.catch(() => {});
    return hit;
  }
  return fresh;
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (API_PATHS.some((p) => url.pathname === p)) e.respondWith(networkFirst(request, API));
    return;
  }
  if (request.mode === 'navigate') {
    e.respondWith(networkFirst(request, STATIC).catch(() => caches.match('/home').then((r) => r || Response.error())));
    return;
  }
  e.respondWith(staleWhileRevalidate(request));
});
