const CACHE_NAME = 'legendary-progression-shell-v26';
const SHELL = [
  '/',
  '/manifest.webmanifest?v=2',
  '/favicon.svg',
  '/brand/dragon-192-v2.png',
  '/brand/dragon-512-v2.png',
  '/brand/dragon-maskable-192-v2.png',
  '/brand/dragon-maskable-512-v2.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put('/', response.clone())));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }
  if (
    url.pathname.startsWith('/assets/')
    || url.pathname === '/manifest.webmanifest'
    || url.pathname === '/favicon.svg'
    || url.pathname.startsWith('/brand/')
    || url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
  }
});