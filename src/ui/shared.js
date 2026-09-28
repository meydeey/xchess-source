// Aides partagées par les écrans de src/ui/ : conversions de camp, libellés, formatage et un petit
// composant de liste virtualisée pour que le catalogue complet (3 815 entrées) reste fluide.
// Pur DOM, sans dépendance à un écran précis, mais IMPORTE les modules livrés par C1 (data.js,
// core/lines.js) : c'est le seul point de la sélection où l'API réelle de ces modules est appelée.
import { getTree, catalogMeta } from '../data.js'
import { linesFromTree } from '../core/lines.js'
import { difficulty } from '../core/metrics.js'

// ---------- camps, tranches, familles ----------
// Le camp vaut 'white' ou 'black' partout (catalogue, cœur, générateur) ; seul le libellé est français.
export const SIDE_LABEL = { white: 'Blancs', black: 'Noirs' }

export const BAND_LABEL = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  club: 'Club',
  avance: 'Avancé',
  expert: 'Expert',
}
export const BAND_ORDER = Object.keys(BAND_LABEL)

export const FAMILY_LABEL = { classique: 'Classique', gambit: 'Gambit', exotique: 'Exotique' }

export const DEFAULT_SETTINGS = { elo: 400, eloSource: 'chesscom', newPerDay: 10, sounds: true, dailyGoal: 60, locale: 'fr', autoNextPuzzle: false }
export const ELO_SOURCE_LABEL = { chesscom: 'Chess.com', lichess: 'Lichess', fide: 'FIDE' }

// ---------- petits formats ----------
export function formatEval(e) {
  if (e == null) return null
  if (Math.abs(e) > 90000) return `#${Math.round((100000 - Math.abs(e)) / 100)}`
  const p = (e / 100).toFixed(1)
  return e > 0 ? `+${p}` : e < 0 ? `−${p.slice(1)}` : '0.0'
}
// Typographie française : espace fine insécable avant %, virgule décimale (73 %, 837,7k, 1,1M).
// Difficulté dans ma tranche (D9, ADR-0005) : une seule fonction pour le filtre et la colonne de la
// Bibliothèque comme pour la fiche, calculée sur l'arbre (généré pour la tranche Débutant, ADR-0002).
// null tant que l'arbre n'existe pas.
export function difficultyOf(header) {
  return header?.metrics ? difficulty(header.metrics) : null
}

export function formatPercent(x) {
  return x == null ? '-' : `${Math.round(x * 100)}\u202f%`
}
export function formatGames(n) {
  if (n == null) return '-'
  const short = (x, unit) => `${String(Math.round(x * 10) / 10).replace('.', ',')}${unit}`
  if (n >= 999950) return short(n / 1e6, 'M')
  if (n >= 1000) return short(n / 1000, 'k')
  return String(n)
}

// definingPly pour linesFromTree (contrat lines.js du 14.7) : le tronc qui définit l'ouverture ne
// branche jamais, la branche commence au dernier coup adverse de ce tronc. Si le dernier coup de la
// séquence qui définit l'ouverture est le mien, ce dernier coup adverse est l'avant-dernier ; sinon
// c'est le dernier coup lui-même. Vérifié sur l'Alien Gambit (11 coups, camp blancs) : definingPly 9,
// soit le 5e coup noir (h6 accepté vs les refus), comme documenté par l'API de lines.js.
export function definingPlyFor(moves, sideEn) {
  const lastPly = moves.length - 1
  const mine = sideEn === 'white' ? lastPly % 2 === 0 : lastPly % 2 === 1
  return Math.max(0, mine ? lastPly - 1 : lastPly)
}
export function isMyPly(ply, sideEn) {
  return sideEn === 'white' ? ply % 2 === 0 : ply % 2 === 1
}

// Texte inséré dans du HTML (noms du catalogue Lichess : apostrophes, guillemets).
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
// « 1.f3 e5 2.g4 Qh4# » : les coups d'une ouverture en notation de partie.
export function movesText(moves) {
  return moves.map((m, i) => `${i % 2 === 0 ? `${i / 2 + 1}.` : ''}${m}`).join(' ')
}

// Normalise pour une recherche insensible aux accents et à la casse ("najdorf" trouve "Najdorf").
export function normalizeText(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export function debounce(fn, ms) {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

// ---------- statistiques d'une entrée du catalogue, pour ma tranche ----------
// stats = export `stats` de src/data.js (catalog/stats.json, {} tant qu'il n'existe pas encore).
// tier : 'selection' (stats.selection[id].bands[band]) ou autre (stats.catalog[id], tranche debutant
// uniquement, contrat 14.3). Rend null si rien n'est mesuré : l'appelant affiche alors '-'.
export function bandStatsFor(stats, id, tier, band) {
  if (tier === 'selection') return stats.selection?.[id]?.bands?.[band] ?? null
  return stats.catalog?.[id] ?? null
}

// ---------- liste virtualisée ----------
// createVirtualList(host, { rowHeight, count, renderRow }) : host doit avoir une hauteur bornée et
// `overflow-y: auto` (voir .vlist en CSS). renderRow(index) rend le innerHTML d'une ligne ; la
// fenêtre visible seule est présente dans le DOM, avec un peu de recouvrement (overscan).
export function createVirtualList(host, { rowHeight, count, renderRow }) {
  host.innerHTML = '<div class="vlist-spacer"><div class="vlist-viewport"></div></div>'
  const spacer = host.querySelector('.vlist-spacer')
  const viewport = host.querySelector('.vlist-viewport')
  let n = count
  let raf = null

  function paint() {
    raf = null
    const overscan = 6
    const first = Math.max(0, Math.floor(host.scrollTop / rowHeight) - overscan)
    const visible = Math.ceil(host.clientHeight / rowHeight) + overscan * 2
    const last = Math.min(n, first + visible)
    viewport.style.transform = `translateY(${first * rowHeight}px)`
    let html = ''
    for (let i = first; i < last; i++) html += renderRow(i)
    viewport.innerHTML = html
  }
  function schedule() {
    if (raf == null) raf = requestAnimationFrame(paint)
  }
  function setCount(next) {
    n = next
    spacer.style.height = `${n * rowHeight}px`
    host.scrollTop = 0
    schedule()
  }
  // Hauteur de ligne variable selon la largeur (rangée compacte sur téléphone) : même contrat, la
  // hauteur reste fixe pour toutes les lignes, seule sa valeur change.
  function setRowHeight(next) {
    if (next === rowHeight) return
    rowHeight = next
    spacer.style.height = `${n * rowHeight}px`
    schedule()
  }
  host.addEventListener('scroll', schedule)
  setCount(count)
  return {
    setCount,
    setRowHeight,
    refresh: schedule,
    destroy() { host.removeEventListener('scroll', schedule) },
  }
}

// ---------- résolution d'une ouverture, et de ses lignes ----------
// resolveOpening(id, { selection, openings }) : cherche d'abord dans la sélection (42 ouvertures,
// stats mesurées), sinon dans le catalogue complet (3 815, Lichess). `tier` distingue les 2 pour
// l'affichage et pour bandStatsFor.
export function resolveOpening(id, { selection = [], openings = [] } = {}) {
  const inSelection = selection.find((o) => o.id === id)
  if (inSelection) return { ...inSelection, tier: 'selection' }
  const inCatalog = openings.find((o) => o.id === id)
  if (inCatalog) return { ...inCatalog, tier: 'catalog' }
  return null
}

// loadOpeningLines(opening) : charge l'arbre (generated:<id> puis catalog/trees/<id>.json, contrat
// getTree du 14.7) et en tire les lignes jouables (linesFromTree, contrat lines.js du 14.7). Rend
// des lignes vides tant que l'arbre n'existe pas encore : les écrans affichent alors l'état
// "pas encore généré" plutôt que de planter.
// `unavailable` : l'ouverture est développée (index du catalogue complet) mais son arbre n'a pas pu
// être chargé, hors ligne sur un appareil qui ne l'a jamais ouverte.
export async function loadOpeningLines(opening) {
  if (!opening) return { tree: null, header: null, lines: [] }
  const stored = await getTree(opening.id)
  if (!stored || !stored.tree) return { tree: null, header: stored?.header ?? null, lines: [], unavailable: !!catalogMeta(opening.id) }
  const sideEn = opening.side
  const definingPly = definingPlyFor(opening.moves, sideEn)
  const lines = linesFromTree(stored.tree, sideEn, { definingPly })
  return { tree: stored.tree, header: stored.header ?? null, lines }
}

// Cache mémoire (durée de la session, jamais persisté) : évite de recharger et reparser le même
// arbre plusieurs fois quand la bibliothèque et la fiche regardent la même ouverture.
const lineCache = new Map()
// Un chargement raté (hors ligne) n'est pas gardé : le prochain appel retente le réseau.
export async function getCachedLines(opening) {
  if (!opening) return { tree: null, header: null, lines: [] }
  if (!lineCache.has(opening.id)) lineCache.set(opening.id, loadOpeningLines(opening))
  const res = await lineCache.get(opening.id)
  if (res.unavailable) lineCache.delete(opening.id)
  return res
}
export function invalidateLineCache(id) {
  lineCache.delete(id)
}

// ---------- petit bus d'actions clavier / menu natif ----------
// Les raccourcis web et le menu natif Tauri (platform.onMenu, contrat 14.6) partagent les mêmes noms
// d'action ('next', 'hint', 'restart', 'tab:train', 'tab:explore', 'tab:lines', 'search', 'library',
// 'session', 'settings'). Chaque écran monté enregistre ses gestionnaires locaux ; les 3 actions de
// navigation globale sont toujours actives, quel que soit l'écran affiché.
export function createActionBus() {
  let local = {}
  return {
    setLocal(handlers) { local = handlers || {} },
    dispatch(action) {
      const fn = local[action]
      if (fn) fn()
    },
  }
}
