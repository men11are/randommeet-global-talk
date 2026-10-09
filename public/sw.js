const CACHE_NAME = 'rm-v2.6.0';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((k) => {
                    if (k !== CACHE_NAME) return caches.delete(k);
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (
        event.request.method !== 'GET' ||
        event.request.url.includes('/socket.io/') ||
        event.request.url.includes('/api/')
    ) {
        return;
    }

    event.respondWith(
        fetch(event.request).catch(async () => {
            const cached = await caches.match(event.request);
            return cached || new Response('Network offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        })
    );
});
