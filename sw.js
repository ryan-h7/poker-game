/* Poker Games Club — cache shell for offline launch; network for API/game. */
const CACHE = 'poker-club-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/main.js',
  '/js/game.js',
  '/js/ui.js',
  '/js/engine.js',
  '/js/ai.js',
  '/js/auth.js',
  '/js/network.js',
  '/js/opponent.js',
  '/js/clipboard.js',
  '/js/promo.js',
  '/js/pwa.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live game / auth — never serve stale API or socket
  if (
    url.pathname.startsWith('/api/')
    || url.pathname.startsWith('/socket.io/')
  ) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok && (url.pathname.endsWith('.js')
          || url.pathname.endsWith('.css')
          || url.pathname.endsWith('.png')
          || url.pathname.endsWith('.webmanifest')
          || url.pathname === '/'
          || url.pathname.endsWith('.html'))) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
