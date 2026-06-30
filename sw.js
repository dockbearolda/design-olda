/* ════════════════════════════════════════════════════
   OLDA · Service Worker — offline + chargement instantané
   Zéro dépendance. Bump CACHE pour invalider à chaque déploiement.
   ════════════════════════════════════════════════════ */
const CACHE = "olda-v1";

// Coquille de l'app pré-cachée à l'installation (tolérant aux 404).
const SHELL = [
  "/",
  "/index.html",
  "/assets/css/style.css",
  "/assets/js/app.js",
  "/data/catalog.json",
  "/data/visibility.json",
  "/manifest.webmanifest",
  "/assets/icons/icon-192.png",
  "/assets/icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // allSettled : un asset manquant n'avorte pas toute l'installation.
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);

  // On ne touche qu'au même origine, en GET, hors API (l'admin doit voir le réseau).
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) {
    return; // comportement réseau natif
  }

  // Navigation (ouverture d'une page) → réseau d'abord, repli sur le cache puis index.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(req)) || (await caches.match("/index.html")) || Response.error();
      }
    })());
    return;
  }

  // Reste (css/js/json/images) → stale-while-revalidate :
  // on sert le cache immédiatement (instantané + offline) et on rafraîchit en fond.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then(res => {
      if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
