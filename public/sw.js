// Kill-switch service worker.
// An older PWA build registered a workbox service worker that precached the app
// and kept serving stale assets, so new deployments never reached installed users.
// This SW replaces it: on activate it deletes every cache, unregisters itself, and
// reloads open windows. After that the app has no service worker and always loads
// the latest version straight from the network.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (e) {}
    try {
      await self.registration.unregister();
    } catch (e) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) {}
  })());
});

// Network-only while this SW is briefly active, so nothing stale is served.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).catch(() => Response.error()));
});
