// Lichess opening explorer client (https://explorer.lichess.ovh/lichess). Requires LICHESS_TOKEN
// (personal token, no scope) since 2025: run tools through `infisical run --env=dev -- ...`.
// One request at a time per process, cached forever in tools/cache/cache.sqlite, backs off on 429.
import { openCache } from './cache.mjs'

const BASE = 'https://explorer.lichess.ovh/lichess'
const SPEEDS = ['blitz', 'rapid', 'classical']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Normalised FEN (no move counters) so transpositions share one cache entry.
export const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ')

export function createExplorer({ token = process.env.LICHESS_TOKEN, cache = openCache(), minIntervalMs = 350 } = {}) {
  if (!token) throw new Error('LICHESS_TOKEN manquant : lancer via `infisical run --env=dev -- ...`')
  let chain = Promise.resolve()
  let last = 0
  let requests = 0

  async function fetchJson(url) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const wait = last + minIntervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      last = Date.now()
      let res
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
      } catch (err) {
        await sleep(2000 * (attempt + 1))
        continue
      }
      requests++
      if (res.status === 429) { await sleep(60000); continue }
      if (res.status >= 500) { await sleep(3000 * (attempt + 1)); continue }
      if (!res.ok) throw new Error(`explorer HTTP ${res.status} for ${url}`)
      return res.json()
    }
    throw new Error(`explorer: too many failures for ${url}`)
  }

  // ratings: explorer buckets among 0,1000,1200,1400,1600,1800,2000,2200,2500.
  // Returns { white, draws, black, moves: [{ uci, san, white, draws, black, averageRating }], opening }.
  function query({ fen, ratings, speeds = SPEEDS, moves = 12 }) {
    const params = new URLSearchParams({
      variant: 'standard', fen: fenKey(fen) + ' 0 1', speeds: speeds.join(','), ratings: ratings.join(','),
      moves: String(moves), topGames: '0', recentGames: '0',
    })
    const url = `${BASE}?${params}`
    const hit = cache.get('explorer', url)
    if (hit) return Promise.resolve(hit)
    const run = chain.then(async () => {
      const again = cache.get('explorer', url)
      if (again) return again
      const json = await fetchJson(url)
      const slim = {
        white: json.white, draws: json.draws, black: json.black, opening: json.opening || null,
        moves: (json.moves || []).map((m) => ({ uci: m.uci, san: m.san, white: m.white, draws: m.draws, black: m.black, averageRating: m.averageRating })),
      }
      cache.set('explorer', url, slim)
      return slim
    })
    chain = run.catch(() => {})
    return run
  }

  return { query, stats: () => ({ requests }) }
}
