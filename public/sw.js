// Self-cleaning Service Worker: Wipes legacy caches and unregisters itself cleanly
// Eliminates stale 503 fetch interception errors permanently
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
            .then(() => self.registration.unregister())
            .catch(() => {})
    );
});
