// Euforia — service worker: abre rápido y sin señal.
// Páginas: red primero (siempre lo último publicado). Estáticos: caché y se refrescan por detrás.
// La API de Apps Script y otros dominios no pasan por aquí.
const CACHE = 'euforia-v5.1';
const SHELL = ['./', 'index.html', 'assets/euforia.css', 'assets/stats.js', 'assets/logo-euforia.webp',
               'assets/fotos/welcome.jpg', 'assets/fotos/home.jpg', 'assets/icons/favicon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
    return;
  }
  // Caché al instante y se actualiza por detrás para la próxima vez
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
