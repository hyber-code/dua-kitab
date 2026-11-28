/* Dua Kitab service worker: makes the app work offline.
   Page images: saved once, then always read from the phone.
   App files: fresh copy when online, saved copy when offline. */
var SHELL = 'shell-v8';
var SHELL_FILES = ['./', 'index.html', 'style.css?v=8', 'app.js?v=8', 'data.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/qr.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k.indexOf('shell-') === 0 && k !== SHELL) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function pageImage(req) {
  var m = /\/pages\/(e\d+)\//.exec(req.url);
  return caches.match(req.url).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open('pages-' + m[1]).then(function (c) { c.put(req.url, copy); }); }
      return res;
    });
  });
}

function appFile(req) {
  var fresh = fetch(req).then(function (res) {
    if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
    return res;
  });
  var saved = function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined);
    });
  };
  var slow = new Promise(function (resolve) { setTimeout(resolve, 3000); }).then(saved);
  return Promise.race([fresh.catch(function () { return undefined; }), slow]).then(function (res) {
    return res || saved().then(function (hit) { return hit || fresh; });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(/\/pages\/e\d+\//.test(req.url) ? pageImage(req) : appFile(req));
});
