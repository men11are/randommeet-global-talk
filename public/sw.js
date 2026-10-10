// Self-cleaning service worker to destroy old 503 errors
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Network-only passthrough: Never block HTML, APIs, or WebSockets
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
