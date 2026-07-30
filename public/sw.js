/**
 * OpusTuner service worker.
 *
 * Strategy:
 *   - navigations  -> network first, falling back to the cached shell so the
 *                     app opens instantly and still works with no signal
 *   - everything else -> cache first (Vite emits content-hashed filenames, so a
 *                     cached asset is never stale for its URL)
 *
 * Bump CACHE_VERSION on release to evict the previous build.
 */

const CACHE_VERSION = 'opustuner-v1';
const SHELL = './index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        cache.addAll([
          './',
          SHELL,
          './manifest.webmanifest',
          './icons/icon-192.png',
          './icons/icon-512.png',
        ]),
      )
      .catch(() => {
        /* a missing optional asset must not block installation */
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(SHELL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
