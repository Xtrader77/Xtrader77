// xX Trading Journal — Service Worker v4 (Optimized)
const CACHE = 'xx-v4';
const PRECACHE = [
    '/',
    '/index.html',
    '/login.html',
    '/register.html',
    '/lock.html',
    '/journal.html',
    '/dashboard.html',
    '/analytics.html',
    '/improvement.html',
    '/profile.html',
    '/db.js',
    '/shared.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Install — precache all app shell files
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

// Activate — delete old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Fetch strategy with network-first for critical paths
self.addEventListener('fetch', e => {
    const url = e.request.url;

    // Supabase — always network
    if (url.includes('supabase.co')) {
        e.respondWith(
            fetch(e.request)
                .then(res => {
                    // Cache successful responses for offline
                    if (res.ok && url.includes('/trades') || url.includes('/cycles')) {
                        const clone = res.clone();
                        caches.open(CACHE + '-api').then(c => c.put(e.request, clone));
                    }
                    return res;
                })
                .catch(() => {
                    // Try cache for API
                    return caches.match(e.request);
                })
        );
        return;
    }

    // CDN resources — cache first
    if (url.includes('cdn.jsdelivr') || url.includes('fonts.googleapis') ||
        url.includes('fonts.gstatic') || url.includes('cdnjs.cloudflare') ||
        url.includes('unpkg.com')) {
        e.respondWith(
            caches.match(e.request).then(cached => {
                if (cached) return cached;
                return fetch(e.request).then(res => {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                    return res;
                });
            })
        );
        return;
    }

    // App shell — stale-while-revalidate with immediate response
    e.respondWith(
        caches.open(CACHE).then(async cache => {
            const cached = await cache.match(e.request);
            const fetchPromise = fetch(e.request).then(res => {
                if (res.ok) cache.put(e.request, res.clone());
                return res;
            }).catch(() => cached);

            // Return cached immediately if available
            if (cached) {
                // Update in background
                fetchPromise.catch(() => {});
                return cached;
            }
            return fetchPromise;
        })
    );
});