// Offline-first service worker for the Hacker Baby kiosk.
//
// Strategy:
// - Navigations (index.html): network-first with a short timeout, so a new
//   deploy shows up on the very next launch but a flaky network can't stall
//   the boot — the cache is the fallback either way.
// - Everything else (hashed assets, icons, cards): cache-first with a
//   background refresh — asset filenames change per build, so stale entries
//   are never served for new HTML.
//
// VERSION is stamped by scripts/stamp-sw.mjs at build time, giving every
// deploy its own cache; activation purges the previous deploy's cache so
// storage doesn't grow forever.
const VERSION = 'ba0f944657';
const CACHE = 'hackerbaby-' + (VERSION.indexOf('__') === 0 ? 'dev' : VERSION);
const NAV_TIMEOUT_MS = 3500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(['./', './index.html', './manifest.webmanifest']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    // kick off the network fetch; whatever happens, it refreshes the cache
    const network = fetch(event.request).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return res;
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('nav timeout')), NAV_TIMEOUT_MS)
    );
    event.respondWith(
      Promise.race([network, timeout]).catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || caches.match('./index.html'))
          .then((cached) => cached || network)
      )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
