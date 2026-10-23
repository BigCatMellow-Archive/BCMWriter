const CACHE_NAME = 'bcmwriter-v1.1.1'; // security update
const ASSETS_TO_CACHE = [
  '/BCMWriter/',
  '/BCMWriter/index.html',
  '/BCMWriter/manifest.json',
  '/BCMWriter/icons/icon-192.png',  // ← ADD THIS
  '/BCMWriter/icons/icon-512.png',  // ← ADD THIS
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'
];

// Install: Cache app assets
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching files');
      return Promise.allSettled(
        ASSETS_TO_CACHE.map(url => 
          cache.add(url).catch(err => {
            console.warn(`Failed to cache ${url}:`, err);
          })
        )
      );
    }).then(() => {
      console.log('Service Worker: Installed');
      return self.skipWaiting(); // Activate immediately
    })
  );
});

// Fetch: Serve from cache for assets, allow API calls through
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // 🔧 CRITICAL FIX: Don't intercept API calls to Cloudflare Worker
  if (url.hostname === 'bcmwriter.goldenjanitors.workers.dev') {
    console.log('Service Worker: Allowing API call through:', url.href);
    return; // Let the request go through normally
  }
  
  // 🔧 Don't intercept Google API calls
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('accounts.google.com')) {
    console.log('Service Worker: Allowing Google API through:', url.href);
    return;
  }
  
  // For app assets, try cache first, then network
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        console.log('Service Worker: Serving from cache:', event.request.url);
        return response;
      }
      
      // Not in cache, fetch from network
      console.log('Service Worker: Fetching from network:', event.request.url);
      return fetch(event.request).catch(err => {
        console.error('Service Worker: Fetch failed:', err);
        // Only return offline page for navigation requests
        if (event.request.mode === 'navigate') {
          return new Response('App is offline. Please check your connection.', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({
              'Content-Type': 'text/plain'
            })
          });
        }
        throw err;
      });
    })
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith('bcmwriter-') && cacheName !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activated');
      return self.clients.claim(); // Take control immediately
    })
  );
});
