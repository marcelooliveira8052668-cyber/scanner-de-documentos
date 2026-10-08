/* =========================================================
   sw.js — guarda o app no celular para funcionar sem internet
   ========================================================= */
'use strict';

const VERSAO = 'scanner-v2';
const ARQUIVOS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/utils.js',
  './js/filters.js',
  './js/pdf.js',
  './js/db.js',
  './js/app.js',
  './js/vendor/qrcode.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSAO)
      .then(cache => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evento => {
  evento.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evento => {
  const req = evento.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // strategy: cache first, rede como plano B (e atualiza o cache)
  evento.respondWith(
    caches.match(req).then(cacheado => {
      const daRede = fetch(req).then(res => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(VERSAO).then(c => c.put(req, copia));
        }
        return res;
      }).catch(() => cacheado);
      return cacheado || daRede;
    })
  );
});