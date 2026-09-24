const CACHE = "videoteam-v18";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// So a casca da app. Os dados (Worker) nunca passam por aqui: sao de outra origem.
// Rede primeiro, cache so quando nao ha rede, para uma correcao aparecer logo.
// cache:"no-store" no pedido feito aqui, para o proprio browser nunca devolver uma
// copia HTTP antiga por baixo do pano — sem isto, "rede primeiro" nem sempre era rede a serio.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  const freshReq = new Request(event.request, { cache: "no-store" });
  event.respondWith(
    fetch(freshReq).then((resp) => {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return resp;
    }).catch(() => caches.match(event.request).then((r) => r || caches.match("./index.html")))
  );
});
