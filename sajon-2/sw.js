'use strict';

const CACHE_NAME = 'chollima-dictionary-v2.0.1';
const OPTIONAL_ASSETS = [
  './',
  './manifest.webmanifest',
  './hello.svg',
  './text_logo.svg',
  './icon.svg',
  './hanja.txt',
  './ejdict-hand-utf8.txt'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(OPTIONAL_ASSETS.map(async assetPath => {
      const request = new Request(new URL(assetPath, self.registration.scope), { cache: 'reload' });
      try {
        const response = await fetch(request);
        if (response.ok && response.type !== 'opaque') {
          await cache.put(request, response.clone());
        }
      } catch (error) {
        // Optional local data/assets may be missing in a partial deployment.
        // Continue installation and allow the online app to operate normally.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('chollima-dictionary-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(request)) || (await cache.match(new URL('./', self.registration.scope).href)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
      return response;
    } catch (error) {
      return Response.error();
    }
  })());
});
