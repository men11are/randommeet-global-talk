const CACHE_NAME = 'rm-v2.5.0';

// Instant takeover without waiting for old worker to die
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// Purana saara stale cache delete karo
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Network-first fetch handler
self.addEventListener('fetch', (event) => {
    // Socket.io, API routes, aur non-GET calls ko bilkul intercept mat karo
    if (
        event.request.method !== 'GET' ||
        event.request.url.includes('/socket.io/') ||
        event.request.url.includes('/api/')
    ) {
        return;
    }

    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});
