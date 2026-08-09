const CACHE = 'thype-v13';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/fx.js',
  './js/ai.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// same-origin: cache-first with background refresh; cross-origin (CDN, model
// shards): network, falling back to cache — WebLLM caches model weights itself.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { /* empty payload */ }
  e.waitUntil(self.registration.showNotification(data.title || 'thype', {
    body: data.body || "a quiet moment for tonight's thought",
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'thype-reminder',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list =>
    list.length ? list[0].focus() : clients.openWindow('./')
  ));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin && url.pathname.includes('/api/')) return;   // live data, never cached

  if (sameOrigin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
  } else {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
