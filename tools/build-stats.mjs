// Mesure les ouvertures via l'explorateur Lichess (spec docs/reference/contrats.md,
// sections 4 et 14.3/14.4). 3 modes :
// --selection (défaut) : 5 tranches x 2 requêtes pour chaque ouverture de catalog/selection.json,
//   écrit stats.selection.
// --catalog [--limit N] : tranche debutant seule, 1 requête par ouverture de catalog/openings.json,
//   écrit stats.catalog.
// --complement : ajoute à la sélection les 3 meilleures ouvertures de chaque camp au scoreLow de
//   la tranche debutant (2 000 parties ou plus, hors doublons), puis mesure leurs 5 tranches.
//   Écarte les lignes où l'adversaire s'est déjà effondré (fin de partie, ou plus de +2,5 pions
//   pour mon camp selon Stockfish) : leur score mesure l'erreur adverse, pas le choix d'ouverture.
//   Idempotent : les entrées 'mesure' précédentes sont retirées avant le nouveau calcul.
//   Nécessite un stats.catalog déjà rempli par `bun run stats -- --catalog` (sans --limit).
// Reprise gratuite : le cache de l'explorateur (tools/cache/cache.sqlite) est permanent, et
// stats.json est réécrit après chaque ouverture, donc une relance après interruption ne refait
// aucune requête déjà servie. Usage : bun run stats [-- --catalog [--limit N] | --complement]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { Chess } from 'chess.js'
import { createExplorer } from './lib/explorer.mjs'
import { EnginePool, cachedEngine } from './lib/uci-engine.mjs'
import { BANDS, bandStats } from '../src/core/metrics.js'

const CATALOG_DIR = new URL('../catalog/', import.meta.url)
const SELECTION_PATH = new URL('selection.json', CATALOG_DIR)
const OPENINGS_PATH = new URL('openings.json', CATALOG_DIR)
const STATS_PATH = new URL('stats.json', CATALOG_DIR)
const SPEEDS = ['blitz', 'rapid', 'classical']

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const numArg = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : undefined
}
const mode = flag('--complement') ? 'complement' : flag('--catalog') ? 'catalog' : 'selection'
const limit = numArg('--limit')

const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'))
const loadStats = () =>
  existsSync(STATS_PATH) ? readJson(STATS_PATH) : { generatedAt: null, speeds: SPEEDS, selection: {}, catalog: {} }

function saveStats(stats) {
  stats.generatedAt = new Date().toISOString()
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2))
}

// FEN après les `count` premiers coups de `moves` (0 = position de départ).
function fenAfter(moves, count) {
  const chess = new Chess()
  for (let i = 0; i < count; i++) chess.move(moves[i])
  return chess.fen()
}

// Index (0-based) des coups qui appartiennent à `side` dans `moves` : Blancs aux index pairs
// (premier coup de la partie), Noirs aux index impairs.
function ownIndices(moves, side) {
  const out = []
  for (let i = 0; i < moves.length; i++) if ((i % 2 === 0 ? 'white' : 'black') === side) out.push(i)
  return out
}

// Compte les fallbacks silencieux à 0 (position hors du top de l'explorateur) : affiché à la fin
// du run pour que le coordinateur distingue une ouverture vraiment non jouée d'un simple trou de
// fenêtre top-N avant de faire confiance à un run complet (--catalog, 3 815 entrées).
const zeroFallbacks = []

// Requête à la position parente de la position finale : donne à la fois la baseline (totaux de
// cette position) et les compteurs du dernier coup (childMove), donc games/score/scoreLow/baseline/
// gain de l'ouverture entière sur cette tranche, en 1 requête.
// `moves: 20` couvre les cas mesurés ici (milliers de parties), mais une ouverture rare du
// catalogue complet peut ne pas figurer dans le top 20 des réponses à la position parente : sur
// un raté on retente une fois avec une fenêtre large avant de retomber sur 0, et on logue chaque
// fallback réel (jamais silencieux) pour distinguer une ligne non jouée d'un trou de fenêtre.
async function queryFinal(opening, ratings, explorer, context) {
  const { moves, side } = opening
  const parentFen = fenAfter(moves, moves.length - 1)
  const lastSan = moves[moves.length - 1]
  let parentResp = await explorer.query({ fen: parentFen, ratings, moves: 20 })
  let childMove = parentResp.moves.find((m) => m.san === lastSan)
  if (!childMove) {
    parentResp = await explorer.query({ fen: parentFen, ratings, moves: 150 })
    childMove = parentResp.moves.find((m) => m.san === lastSan)
  }
  if (!childMove) {
    const entry = { id: opening.id, band: context?.bandId ?? null, ratings }
    zeroFallbacks.push(entry)
    console.warn(`attention : ${opening.id} (${lastSan}) absent du top 150 de l'explorateur à ratings=${ratings.join(',')}, fallback à 0 parties`)
    childMove = { white: 0, draws: 0, black: 0 }
  }
  return bandStats(parentResp, childMove, side)
}

// Taux d'entrée (section 4) : part des parties où l'adversaire coopère jusqu'à ma ligne. 2e
// requête, à la position qui suit mon propre coup précédent (juste avant la réponse adverse
// décisive) ; jeux atteignant la position finale / jeux atteignant cette position. 1 sans requête
// si mon dernier coup n'a aucun coup adverse avant lui dans la ligne (moins de 2 coups de mon
// camp : rien à faire entrer, ex. 1.c4 seul).
async function queryEntry(opening, ratings, finalGames, explorer) {
  const { moves, side } = opening
  const idxs = ownIndices(moves, side)
  if (idxs.length < 2) return 1
  const prevOwn = idxs[idxs.length - 2]
  const entryFen = fenAfter(moves, prevOwn + 1)
  const resp = await explorer.query({ fen: entryFen, ratings, moves: 1 })
  const denom = resp.white + resp.draws + resp.black
  return denom > 0 ? finalGames / denom : 0
}

async function measureBand(opening, bandId, explorer) {
  const ratings = BANDS[bandId].ratings
  const stats = await queryFinal(opening, ratings, explorer, { bandId })
  const entry = await queryEntry(opening, ratings, stats.games, explorer)
  return { ...stats, entry }
}

// 1 requête, tranche debutant seule (mode --catalog) : mêmes champs que queryFinal, sans entry.
async function measureDebutant(opening, explorer) {
  const s = await queryFinal(opening, BANDS.debutant.ratings, explorer, { bandId: 'debutant' })
  return { games: s.games, score: s.score, scoreLow: s.scoreLow, gain: s.gain }
}

async function runSelection(explorer) {
  const selection = readJson(SELECTION_PATH)
  const stats = loadStats()
  const t0 = Date.now()
  for (let i = 0; i < selection.length; i++) {
    const opening = selection[i]
    const bands = {}
    for (const bandId of Object.keys(BANDS)) bands[bandId] = await measureBand(opening, bandId, explorer)
    stats.selection[opening.id] = { bands }
    saveStats(stats)
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`[${i + 1}/${selection.length}] ${opening.id} : ${elapsed}s écoulées, ${explorer.stats().requests} requêtes`)
  }
  return stats
}

async function runCatalog(explorer) {
  const openings = readJson(OPENINGS_PATH)
  const limited = limit ? openings.slice(0, limit) : openings
  const stats = loadStats()
  const t0 = Date.now()
  for (let i = 0; i < limited.length; i++) {
    const opening = limited[i]
    stats.catalog[opening.id] = await measureDebutant(opening, explorer)
    const last = i === limited.length - 1
    if ((i + 1) % 20 === 0 || last) {
      saveStats(stats)
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
      console.log(`[${i + 1}/${limited.length}] ${elapsed}s écoulées, ${explorer.stats().requests} requêtes`)
    }
  }
  return stats
}

// Même règle de slug que build-catalog.mjs (ASCII, minuscule, tirets), avec suffixe -2, -3 sur
// doublon dans l'ensemble d'ids déjà pris.
function uniqueId(name, seen) {
  const base = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  let id = base
  let n = 2
  while (seen.has(id)) { id = `${base}-${n}`; n++ }
  seen.add(id)
  return id
}

// Noms Lichess (anglais) traduits pour l'affichage des entrées de complément : famille connue,
// puis « X Variation » devient « variante X ». Les noms propres restent tels quels.
const FAMILY_FR = [
  ["King's Pawn Game", 'Partie du pion roi'], ["Queen's Pawn Game", 'Partie du pion dame'],
  ['Italian Game', 'Partie italienne'], ['Ruy Lopez', 'Partie espagnole'], ['Scotch Game', 'Partie écossaise'],
  ['Scotch Gambit', 'Gambit écossais'], ['Vienna Game', 'Partie viennoise'], ['Four Knights Game', 'Partie des quatre cavaliers'],
  ["Bishop's Opening", 'Ouverture du fou'], ["Petrov's Defense", 'Défense Petrov'], ['Philidor Defense', 'Défense Philidor'],
  ['Sicilian Defense', 'Défense sicilienne'], ['French Defense', 'Défense française'], ['Caro-Kann Defense', 'Défense Caro-Kann'],
  ['Scandinavian Defense', 'Défense scandinave'], ["Queen's Gambit Declined", 'Gambit dame refusé'],
  ["Queen's Gambit Accepted", 'Gambit dame accepté'], ["Queen's Gambit", 'Gambit dame'], ["King's Gambit", 'Gambit du roi'],
  ['English Opening', 'Ouverture anglaise'], ['London System', 'Système de Londres'], ['Two Knights Defense', 'Défense des deux cavaliers'],
  ['Giuoco Piano', 'Giuoco Piano'], ['Giuoco Pianissimo', 'Giuoco Pianissimo'], ['Exchange Variation', "variante d'échange"],
  ['Main Line', 'ligne principale'], ['Open', 'variante ouverte'], ['Indian Defense', 'Défense indienne'],
]
const KIND_FR = { Variation: 'variante', Attack: 'attaque', Defense: 'défense', Gambit: 'gambit', Countergambit: 'contre-gambit', Line: 'ligne', System: 'système', Opening: 'ouverture', Trap: 'piège' }
export function translateName(name) {
  const known = (p) => FAMILY_FR.find(([en]) => en === p)?.[1]
  const [family, rest] = name.split(': ')
  const head = known(family) ?? family
  if (!rest) return head
  const parts = rest.split(', ').map((p) => {
    if (known(p)) return known(p)
    const g = p.match(/^(.*) Gambit (Accepted|Declined)$/)
    if (g) return `gambit ${g[1]} ${g[2] === 'Accepted' ? 'accepté' : 'refusé'}`
    const m = p.match(/^(.*) (Variation|Attack|Defense|Gambit|Countergambit|Line|System|Opening|Trap)$/)
    return m ? `${KIND_FR[m[2]]} ${m[1]}` : p
  })
  return `${head} : ${parts.join(', ')}`
}

const SPRUNG_TRAP_CP = 250

async function runComplement(explorer) {
  const stats = loadStats()
  if (!Object.keys(stats.catalog).length) {
    throw new Error('stats.catalog est vide : lancer `bun run stats -- --catalog` (catalogue complet) avant --complement')
  }
  const openings = readJson(OPENINGS_PATH)
  const previous = readJson(SELECTION_PATH)
  const selection = previous.filter((o) => o.source !== 'mesure')
  for (const o of previous) if (o.source === 'mesure') delete stats.selection[o.id]
  const pool = new EnginePool({ size: 1, threads: 4 })
  const engine = cachedEngine(pool)
  const seenIds = new Set(selection.map((o) => o.id))
  const seenFens = new Set(selection.map((o) => fenAfter(o.moves, o.moves.length)))

  for (const camp of ['white', 'black']) {
    const candidates = openings
      .filter((o) => o.side === camp)
      .map((o) => ({ opening: o, s: stats.catalog[o.id] }))
      .filter(({ s }) => s && s.games >= 2000)
      .sort((a, b) => b.s.scoreLow - a.s.scoreLow)
    let added = 0
    for (const { opening } of candidates) {
      if (added >= 3) break
      const fen = fenAfter(opening.moves, opening.moves.length)
      if (seenFens.has(fen)) continue // doublon de la sélection (même position finale)
      if (new Chess(fen).isGameOver()) { console.log(`écartée (fin de partie) : ${opening.name}`); continue }
      const [best] = await engine.analyse(fen, { depth: 14, movetime: 500 })
      const forSide = camp === 'white' ? best.score : -best.score
      if (forSide > SPRUNG_TRAP_CP) { console.log(`écartée (adversaire déjà effondré, ${forSide} cp) : ${opening.name}`); continue }
      const family = /gambit|countergambit/i.test(opening.name) ? 'gambit' : 'classique'
      selection.push({
        id: uniqueId(opening.name, seenIds),
        name: translateName(opening.name),
        lichessName: opening.name,
        eco: opening.eco,
        side: opening.side,
        // Contrairement aux 42 de la spec (sideRule 'chosen', colonne Camp), une entrée de
        // complément n'a pas de table d'origine : side vient tel quel de openings.json, donc
        // littéralement le dernier coup joué (voir build-catalog.mjs).
        sideRule: 'lastMover',
        family,
        moves: opening.moves,
        provisionalLevel: 'debutant', // trouvée au meilleur scoreLow de cette tranche précise
        source: 'mesure',
      })
      seenFens.add(fen)
      added++
    }
    console.log(`complément ${camp} : ${added} ouverture(s) ajoutée(s) à la sélection`)
  }
  pool.close()
  saveStats(stats)
  writeFileSync(SELECTION_PATH, JSON.stringify(selection, null, 2))
  // Mesure les 5 tranches de toute la sélection : gratuit sur les entrées déjà mesurées (cache).
  return runSelection(explorer)
}

const explorer = createExplorer()
if (mode === 'selection') await runSelection(explorer)
else if (mode === 'catalog') await runCatalog(explorer)
else await runComplement(explorer)
console.log(`terminé (${mode}) : ${explorer.stats().requests} requêtes au total`)
if (zeroFallbacks.length) {
  console.warn(`${zeroFallbacks.length} position(s) hors du top explorateur, fallback à 0 (voir les avertissements ci-dessus) :`)
  for (const f of zeroFallbacks) console.warn(`  - ${f.id} (${f.band ?? '?'}, ratings=${f.ratings.join(',')})`)
}
