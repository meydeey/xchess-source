// Service worker de la version web installable (iPhone, écran d'accueil) : rend l'app jouable hors
// ligne. Enregistré par src/main.js en plateforme web seulement, jamais dans l'app Tauri.
// - Page (index.html, qui embarque tout le catalogue) : réseau d'abord, cache hors ligne.
//   Chaque nouveau build change la clé du cache et recharge les fenêtres ouvertes à l'activation.
// - Fichiers du site : cache d'abord, réseau ensuite, mis en cache au passage.
const CACHE = 'xchess-__XCHESS_RELEASE__'
const SHELL = ['./', './manifest.webmanifest', './favicon.ico', './favicon.svg', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './engine/stockfish-19-lite-single.js', './engine/stockfish-19-lite-single.wasm', './packs/index.json', './packs/puzzles-2026-09.json', './packs/puzzles-motifs-2026-10.json', './packs/puzzles-advanced-2026-10.json']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((windows) => Promise.all(windows.map((client) => client.navigate?.(client.url)?.catch(() => {})))),
  )
})

async function refreshPage(cache) {
  const res = await fetch('./', { cache: 'no-cache' })
  if (res.ok) await cache.put('./', res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (req.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      try { return await refreshPage(cache) }
      catch (error) {
        const cached = await cache.match('./')
        if (cached) return cached
        throw error
      }
    }))
    return
  }

  if (url.origin === self.location.origin) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      if (cached) return cached
      const res = await fetch(req)
      if (res.ok || res.type === 'opaque') await cache.put(req, res.clone())
      return res
    }))
  }
})
