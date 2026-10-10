// Self-cleaning service worker: completely destroys legacy 503 cache
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Direct passthrough: Never intercepts HTML, WebSocket, or API calls
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
