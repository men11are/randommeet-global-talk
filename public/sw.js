const CACHE_NAME = 'rm-v3.0.0';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(keys.map((k) => caches.delete(k)));
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    // Socket.io aur API ko kabhi chhedna nahi
    if (event.request.url.includes('/socket.io/') || event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        fetch(event.request).catch(async () => {
            const cached = await caches.match(event.request);
            if (cached) return cached;
            return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
});
