// xX Trading Journal — Service Worker v3 (cache-first, fast)
const CACHE = 'xx-v3';
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

// Fetch strategy:
// - Supabase API: network only (always fresh data)
// - Google Fonts: cache first
// - CDN scripts (Chart.js etc): cache first
// - App shell (html/js): cache first, update in background
self.addEventListener('fetch', e => {
    const url = e.request.url;

    // Supabase — always network
    if (url.includes('supabase.co')) {
        e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
        return;
    }

    // CDN resources — cache first (they rarely change)
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

    // App shell — cache first, refresh in background (stale-while-revalidate)
    if (e.request.destination === 'document' ||
        url.endsWith('.js') || url.endsWith('.html') ||
        url.endsWith('.css') || url.endsWith('.png') ||
        url.endsWith('.json')) {
        e.respondWith(
            caches.open(CACHE).then(async cache => {
                const cached = await cache.match(e.request);
                const fetchPromise = fetch(e.request).then(res => {
                    if (res.ok) cache.put(e.request, res.clone());
                    return res;
                }).catch(() => cached);

                // Return cached immediately, update in background
                return cached || fetchPromise;
            })
        );
        return;
    }

    // Everything else — network with cache fallback
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
