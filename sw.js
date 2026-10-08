/* =========================================================
   sw.js — guarda o app no celular para funcionar sem internet
   ========================================================= */
'use strict';

const VERSAO = 'scanner-v8';
const V = '?v=8';                    // mesma versão usada no index.html
const ARQUIVOS = [
  './',
  './index.html',
  './styles.css' + V,
  './manifest.json',
  './js/utils.js' + V,
  './js/filters.js' + V,
  './js/pdf.js' + V,
  './js/zip.js' + V,
  './js/db.js' + V,
  './js/app.js' + V,
  './js/vendor/qrcode.js' + V,
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', evento => {
  evento.waitUntil(
    caches.open(VERSAO)
      // addAll falha inteiro se um arquivo faltar: melhor assim do que cache pela metade
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
  if (new URL(req.url).origin !== location.origin) return;

  /* Estratégia: rede primeiro, cache como reserva.
     Assim o app atualizado chega na hora (importante para quem
     já instalou na tela de início) e continua funcionando sem
     internet, porque a segunda visita usa o cache.

     O `cache: 'reload'` na navegação é essencial: sem ele o
     navegador entrega o index.html velho do próprio cache e a
     atualização não chega nunca. */
  evento.respondWith((async () => {
    try {
      const opcoes = req.mode === 'navigate' ? { cache: 'reload' } : undefined;
      const resposta = await fetch(req, opcoes);
      if (resposta && resposta.ok) {
        const copia = resposta.clone();
        caches.open(VERSAO).then(c => c.put(req, copia));
      }
      return resposta;
    } catch (e) {
      const salvo = await caches.match(req);
      if (salvo) return salvo;
      if (req.mode === 'navigate') {
        const inicio = await caches.match('./index.html');
        if (inicio) return inicio;
      }
      throw e;
    }
  })());
});