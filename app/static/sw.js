// Service Worker: hält die Oberfläche zwischengespeichert, damit die App schnell startet.
// Die Abfrage selbst braucht weiterhin den Server (Prüfen + Statistik).
const CACHE = "vokabeltrainer-v1";
const ASSETS = ["/", "/static/style.css", "/static/app.js", "/static/manifest.webmanifest", "/static/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Netzwerk zuerst (damit Updates sofort ankommen), Cache als Rückfall
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
