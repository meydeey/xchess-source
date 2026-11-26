// Service worker de la version web installable (iPhone, écran d'accueil) : rend l'app jouable hors
// ligne. Enregistré par src/main.js en plateforme web seulement, jamais dans l'app Tauri.
// - Page (index.html, qui embarque tout le catalogue) : réseau d'abord, cache hors ligne.
//   Chaque nouveau build change la clé du cache et recharge les fenêtres ouvertes à l'activation.
// - Fichiers du site : cache d'abord, réseau ensuite, mis en cache au passage.
const CACHE = 'xchess-__XCHESS_RELEASE__'
const INFO_PAGES = ['./support.html', './privacy.html']
const SHELL = ['./', ...INFO_PAGES, './info.css', './manifest.webmanifest', './favicon.ico', './favicon.svg', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './engine/stockfish-19-lite-single.js', './engine/stockfish-19-lite-single.wasm', './packs/index.json', './packs/puzzles-2026-09.json', './packs/puzzles-motifs-2026-10.json', './packs/puzzles-advanced-2026-10.json']
const ART = ['./art/brand.webp', './art/opening.webp', './art/tactics.webp', './art/progress.webp', './art/skill-mixed.webp', './art/skill-attack.webp', './art/skill-tactics.webp', './art/skill-defense.webp', './art/skill-technique.webp', './art/skill-motifs.webp', './art/advanced-series.webp', './art/advanced-timed.webp', './art/advanced-rush.webp', './art/advanced-arena.webp']
const MUSIC = Array.from({ length: 10 }, (_, i) => `./music/${String(i + 1).padStart(2, '0')}.mp3`)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all([
    cache.addAll([...SHELL, ...ART]),
    cache.addAll(MUSIC).catch(() => {}), // A missing download must leave offline chess usable.
  ])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((windows) => {
        // A controlled navigation waits for activation; awaiting it here would deadlock.
        for (const client of windows) client.navigate?.(client.url)?.catch(() => {})
      }),
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
  if (url.origin !== self.location.origin) return

  const infoPage = INFO_PAGES.find((page) => new URL(page, self.registration.scope).pathname === url.pathname)
  if (req.mode === 'navigate' && !infoPage) {
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

  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const key = infoPage ?? req
    const cached = await cache.match(key)
    if (cached) return cached
    const res = await fetch(req)
    if (res.status === 200 || res.type === 'opaque') await cache.put(key, res.clone()).catch(() => {})
    return res
  }))
})
