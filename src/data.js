// Accès aux données du catalogue. Les 3 fichiers de premier niveau sont chargés au démarrage
// (eager) ; les arbres, plus lourds et nombreux, à la demande (paresseux). Tolère tout fichier
// absent : d'autres agents les produisent en parallèle sur ce même chantier.
import { platform } from './platform/index.js'

const selectionModules = import.meta.glob('../catalog/selection.json', { eager: true })
const statsModules = import.meta.glob('../catalog/stats.json', { eager: true })
const openingsModules = import.meta.glob('../catalog/openings.json', { eager: true })
const treeModules = import.meta.glob('../catalog/trees/*.json')
const explainModules = import.meta.glob('../catalog/explain/*.json')

function firstEager (modules, fallback) {
  const key = Object.keys(modules)[0]
  if (!key) return fallback
  const mod = modules[key]
  const value = mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod
  return value ?? fallback
}

export const selection = firstEager(selectionModules, [])
export const stats = firstEager(statsModules, {})
export const openings = firstEager(openingsModules, [])

// Catalogue complet développé (ADR-0006) : arbres et explications des 3 815 ouvertures hors sélection
// dans public/catalog-full/, trop lourds pour le bundle unique, chargés à la demande et gardés par le
// service worker. L'index embarqué donne lignes et difficulté sans rien télécharger ; une ouverture
// identique à une ouverture sélectionnée (mêmes coups, même camp) renvoie à son arbre (alias).
const fullIndexModules = import.meta.glob('../catalog/full-index.json', { eager: true })
export const fullIndex = firstEager(fullIndexModules, { entries: {} })
export function catalogMeta (id) {
  const e = fullIndex.entries?.[id]
  return e && e.lines != null ? { lines: e.lines, difficulty: e.difficulty } : null
}

async function fromModule (loader) {
  if (!loader) return null
  try {
    const mod = await loader()
    return mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod ?? null
  } catch {
    return null
  }
}
async function fromFull (kind, id) {
  const hash = fullIndex.entries?.[id]?.hash
  if (!hash) return null
  try {
    const res = await fetch(`catalog-full/${kind}/${encodeURIComponent(id)}.json?v=${hash}`)
    return res.ok ? await res.json() : null
  } catch {
    return null // hors ligne, fichier jamais ouvert sur cet appareil
  }
}
async function fromStore (key) {
  try {
    return (await platform.store.get(key)) || null
  } catch {
    return null // stockage indisponible : on retombe sur le fichier livré
  }
}

// getTree(id) : d'abord la version régénérée dans l'app (platform.store, clé generated:<id>), sinon
// l'arbre de la sélection (catalog/trees/<id>.json, ou celui de son alias), sinon le catalogue complet
// (public/catalog-full/trees/<id>.json), sinon null.
export async function getTree (id) {
  const alias = fullIndex.entries?.[id]?.alias
  return (await fromStore(`generated:${id}`))
    ?? (await fromModule(treeModules[`../catalog/trees/${alias || id}.json`]))
    ?? (await fromFull('trees', id))
}

// getExplanations(id) : même ordre que getTree, clé explain:<id> du store, puis catalog/explain/,
// puis public/catalog-full/explain/ ; null tant qu'aucune n'existe (15.3).
export async function getExplanations (id) {
  const alias = fullIndex.entries?.[id]?.alias
  return (await fromStore(`explain:${id}`))
    ?? (await fromModule(explainModules[`../catalog/explain/${alias || id}.json`]))
    ?? (await fromFull('explain', id))
}
