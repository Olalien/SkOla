// OlaSkole Service Worker — offline-støtte
const CACHE = 'olaskole-v1';
const ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=Fredoka+One&family=Nunito:wght@400;600;700;800;900&display=swap',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js',
];

// Installer: forhåndsbuffer nødvendige filer
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// Aktiver: rydd gamle cacher
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for eiendeler, network-first for API/DB
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Ikke cache API-kall, firebase, eller POST-forespørsler
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis.com') && url.pathname.includes('/identitytoolkit')) return;

  // Network-first for dynamisk innhold (samme origin, unntatt selve HTML-filen)
  if (url.origin === location.origin && url.pathname !== '/' && !url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for statiske eiendeler (fonter, scripts, HTML)
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});
