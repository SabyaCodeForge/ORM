// NovaCRM service worker
// Bump this whenever index.html (or this file) changes so clients pick up the update.
const CACHE_VERSION = 'novacrm-v4';
const CORE_CACHE = `${CACHE_VERSION}-core`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Everything needed to load the app shell with no network connection.
// Paths are relative to this file's scope (the folder you deploy it in).
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './mark.png',
  './lockup.png'
];

// Third-party libs the app depends on — cached best-effort so the app still
// works offline after the first successful load, even though these are
// cross-origin (opaque) responses.
const RUNTIME_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // Cache each core asset individually rather than cache.addAll(), which
    // rejects (and aborts the ENTIRE install — killing offline support and
    // update notifications with no visible error) the moment a single asset
    // 404s or is momentarily unreachable. One bad/missing file should degrade
    // gracefully, not take down the whole service worker.
    await Promise.all(
      CORE_ASSETS.map((url) =>
        cache.add(url).catch((err) => {
          console.warn('[sw] failed to cache core asset, continuing:', url, err);
        })
      )
    );
    // Best-effort: don't fail install if a CDN is unreachable at build time.
    const runtime = await caches.open(RUNTIME_CACHE);
    await Promise.all(
      RUNTIME_ASSETS.map((url) =>
        fetch(url, { mode: 'no-cors' })
          .then((res) => runtime.put(url, res))
          .catch(() => {})
      )
    );
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('novacrm-') && key !== CORE_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCoreDoc = isSameOrigin && (
    request.mode === 'navigate' ||
    CORE_ASSETS.some((asset) => url.pathname.endsWith(asset.replace('./', '/')))
  );

  if (isCoreDoc) {
    // Network-first for the app shell so users get updates when online,
    // falling back to cache (and finally the cached HTML) when offline.
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(CORE_CACHE);
        cache.put(request, fresh.clone());
        return fresh;
      } catch (err) {
        const cache = await caches.open(CORE_CACHE);
        const cached = await cache.match(request);
        return cached || cache.match('./index.html');
      }
    })());
    return;
  }

  if (RUNTIME_ASSETS.includes(request.url) || url.hostname === 'fonts.gstatic.com') {
    // Cache-first for third-party libs/fonts — they're versioned in their URLs.
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const fresh = await fetch(request, { mode: 'no-cors' });
        cache.put(request, fresh.clone());
        return fresh;
      } catch (err) {
        return cached;
      }
    })());
  }
});
