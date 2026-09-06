/**
 * Easy as Tuning service worker.
 *
 * Strategy:
 *   - navigations  -> network first, falling back to the cached shell so the
 *                     app opens instantly and still works with no signal
 *   - everything else -> cache first (Vite emits content-hashed filenames, so a
 *                     cached asset is never stale for its URL)
 *
 * CACHE_VERSION is rewritten at build time by the precache-sw plugin, with a
 * hash of what the build produced. It must not be edited by hand: the value
 * here is only what the dev server sees, and the point of stamping it is that
 * the activate handler below — which deletes every cache that is not the
 * current one — has something to actually delete.
 */

const CACHE_VERSION = 'easyastuning-dev';
const SHELL = './index.html';
/*
 * The directory the worker was served from, with its trailing slash. On Pages
 * the app lives under /<repo>/, so a bare '/' would never match.
 */
const scopePath = new URL('./', self.location.href).pathname;

/**
 * Everything the app needs to start with no network, filled in at build time by
 * the precache-sw plugin in vite.config.ts — the filenames are content-hashed
 * and cannot be written by hand.
 *
 * Precaching rather than relying on the fetch handler is the difference between
 * working offline after one visit and after two. A newly registered worker does
 * not see the requests the page has already made, so on a first visit the
 * script, the stylesheet and the font are fetched before it is running and none
 * of them land in the cache. Anyone who opened the app once and then lost
 * signal would find nothing there.
 */
const PRECACHE = [
  './',
  SHELL,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  /* BUILD_ASSETS */
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // One at a time rather than addAll, which rejects the whole batch if any
      // single entry 404s and would leave the app with no offline copy at all.
      .then((cache) =>
        Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))),
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
    /*
     * Only the app itself is worth keeping as the shell.
     *
     * This used to cache every successful navigation under SHELL, which was
     * harmless while the app was the only page on the origin. It is not any
     * more: the privacy policy and the support page are served from here too,
     * and visiting either one would have replaced the offline copy of the
     * tuner with a page of prose. Opening the app on a plane would then show
     * the privacy policy.
     */
    const isApp = url.pathname === scopePath || url.pathname === scopePath + 'index.html';
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isApp) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(SHELL, copy));
          }
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
