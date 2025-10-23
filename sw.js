const CACHE_NAME = 'perspicacity-v2'; // Increment version

const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/site.webmanifest',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/favicon.png',
  '/assets/favicon.svg',
  '/assets/favicon.ico',
  '/assets/apple-touch-icon.png',
  '/assets/icon-192-maskable.png',
  '/assets/icon-512-maskable.png'
];

// Install service worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  // Force immediate activation
  self.skipWaiting();
});

// Activate and clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Cache and return requests
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
