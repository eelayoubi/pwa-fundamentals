import { precacheStaticAssets, removeUnusedCaches, ALL_CACHES, ALL_CACHES_LIST } from './sw/caches';
import { openDb } from 'idb';

const FALLBACK_IMAGE_URLS = ['grocery', 'bakery', 'dairy', 'frozen', 'fruit', 'herbs', 'meat', 'vegetables']
  .map(item => `https://localhost:3100/images/fallback-${item}.png`);

// the localhost file is cached in cahces.js, in the precacheStaticAssets()
const INDEX_HTML_PATH = '/';
const INDEX_HTML_URL = new URL(INDEX_HTML_PATH, self.location).toString();

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      // Get the fallback image
      caches.open(ALL_CACHES.fallbackImages).then(cache => {
        return cache.addAll(FALLBACK_IMAGE_URLS)
      }),
      // Populate the precache stuff
      precacheStaticAssets(),
      downloadGroceryItems()
    ])
  );
});

/**
 * get the indexedb 'groceryitem-store'
 */
function getGroceryDb() {
  return openDb('groceryitem-store', 1, upgradeDb => {
    switch (upgradeDb.oldVersion) {
      case 0:
      case 1:
        console.log('Creating the grocery-items object store');
        upgradeDb.createObjectStore('grocery-items', { keyPath: 'id' });
    }
  })
}

/**
 * call the api to fetch all the groceries
 * and add them to the objectstore 'grocery-items'
 * in the indexeddb
 */
function downloadGroceryItems() {
  return getGroceryDb().then(db => {
    fetch('https://localhost:3100/api/grocery/items?limit=99999')
      .then(response => response.json())
      .then(({ data: groceryItems }) => {
        const tx = db.transaction('grocery-items', 'readwrite');
        const store = tx.objectStore('grocery-items');

        return Promise.all(
          groceryItems.
            map(items => store.add(items)))
          .catch(e => {
            console.log(e);
            return tx.abort();
          })
          .then(console.log('All items added successfully!'));
      });
  });
}

self.addEventListener('activate', event => {
  event.waitUntil(
    removeUnusedCaches(ALL_CACHES_LIST)
  );
});

/**
 * get the fall back  image for a specific grocery category
 * @param {*} request 
 */
function fallbackImageForRequest(request) {
  let url = new URL(request.url);
  let pathName = url.pathname;
  let itemId = parseInt(pathName.substring(pathName.lastIndexOf('/') + 1, pathName.lastIndexOf('.')), 10);
  return getGroceryDb().then(db => {
    const tx = db.transaction('grocery-items', 'readwrite');
    const store = tx.objectStore('grocery-items');
    return store.get(itemId);
  }).then(item => {
    let { category } = item;
    return caches.match(`https://localhost:3100/images/fallback-${category.toLowerCase()}.png`, { cacheName: ALL_CACHES.fallbackImages })
  })
}

function fetchImageOrFallback(fetchEvent) {
  return fetch(fetchEvent.request, { mode: 'cors' })
    .then((response) => {
      let responseClone = response.clone();
      if (!response.ok) {
        return fallbackImageForRequest(fetchEvent.request);
      }
      caches.open(ALL_CACHES.fallback).then(cache => {
        // Successful response
        if (response.ok) {
          // Begin the process of adding the response to the cache
          cache.put(fetchEvent.request, responseClone);
        }
      })
      return response;
    })
    .catch(() => {
      return caches.match(fetchEvent.request, { cacheName: ALL_CACHES.fallback }).then(response => {
        return response || fallbackImageForRequest(fetchEvent.request);
      });
    })
}

/**
 * @return {Promise<Response>}
 */
function fetchApiJsonWithFallback(fetchEvent) {
  return caches.open(ALL_CACHES.fallback).then((cache) => {
    return fetch(fetchEvent.request)
      .then(response => {
        // Clone the response so we can return one and store one
        let responseClone = response.clone();
        // Successful response
        if (response.ok) {
          // Begin the process of adding the response to the cache
          cache.put(fetchEvent.request, responseClone);
        }
        // Return the original response
        return response;
      })
      .catch(() => {
        return cache.match(fetchEvent.request);
      })
    // cache.add or addAll (request or url)
  })

  // try to go to the network for some json
  //   when it comes back, begin the process of putting it in the cache
  //   and resolve the promise with the original response 
  // in the event that it doesn't work out
  // serve from the cache
}

self.addEventListener('fetch', event => {
  let acceptHeader = event.request.headers.get('accept');
  let requestUrl = new URL(event.request.url);
  let isGroceryImage = acceptHeader.indexOf('image/*') >= 0 && requestUrl.pathname.indexOf('/images/') === 0;
  let isFromApi = requestUrl.origin.indexOf('localhost:3100') >= 0;
  let isHTML = event.request.headers.get('accept').indexOf('text/html') !== -1;
  let isLocal = new URL(event.request.url).origin === location.origin;

  if (isHTML && isLocal) {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(INDEX_HTML_URL, { cacheName: ALL_CACHES.prefetch }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { cacheName: ALL_CACHES.prefetch })
      .then(response => {
        // Cache hit! Return the precached response
        if (response) return response;
        // Handle grocery images
        if (acceptHeader && isGroceryImage) {
          return fetchImageOrFallback(event)
        } else if (isFromApi && event.request.method === 'GET') {
          return fetchApiJsonWithFallback(event)
        } else {
          // Everything else falls back to the network
          return fetch(event.request);
        }
      })
  );
});