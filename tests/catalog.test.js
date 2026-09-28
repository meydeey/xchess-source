// Cohérence du catalogue livré : chaque ouverture de catalog/selection.json a son arbre
// (catalog/trees/<id>.json, 14.3) et ses explications (catalog/explain/<id>.json, 15.2), du bon
// camp, et chaque coup de l'arbre a sa fiche. Garde-fou avant de reconstruire l'app : ni l'auto-test
// natif ni les autres tests ne lisent ces fichiers, une ouverture cassée s'afficherait sans aide.
import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Chess } from 'chess.js'
import { difficulty } from '../src/core/metrics.js'

const CATALOG = new URL('../catalog/', import.meta.url).pathname
const selection = JSON.parse(readFileSync(`${CATALOG}selection.json`, 'utf8'))
const load = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null)

// Clés au format 15.2 (SAN rejoués par chess.js, suffixes +/# compris) de tous les nœuds de l'arbre.
function treeKeys(tree) {
  const keys = []
  const walk = (nodes, fen, path) => {
    for (const node of nodes || []) {
      const mv = new Chess(fen).move(node.m)
      const next = [...path, mv.san]
      keys.push(next.join(' '))
      walk(node.c, mv.after, next)
    }
  }
  walk(tree, new Chess().fen(), [])
  return keys
}

describe('catalogue livré', () => {
  test('48 ouvertures sélectionnées, ids uniques', () => {
    expect(selection.length).toBe(48)
    expect(new Set(selection.map((o) => o.id)).size).toBe(48)
  })

  for (const o of selection) {
    test(`${o.id} : arbre et explications présents, cohérents et complets`, () => {
      const tree = load(`${CATALOG}trees/${o.id}.json`)
      const explain = load(`${CATALOG}explain/${o.id}.json`)
      expect(tree).not.toBeNull()
      expect(explain).not.toBeNull()
      expect(tree.header.id).toBe(o.id)
      expect(tree.header.side).toBe(o.side)
      expect(explain.header.id).toBe(o.id)
      expect(explain.header.side).toBe(o.side)

      const keys = treeKeys(tree.tree)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys.filter((k) => !explain.nodes[k])).toEqual([])
      const known = new Set(keys)
      expect(Object.keys(explain.nodes).filter((k) => !known.has(k))).toEqual([])
    })
  }
})

// Fins de ligne (spec V2, L0 point 2) : « Échec et mat » seulement sur un mat réel ; une éval de mat
// sans mat sur l'échiquier devient « Mat en N » (11 lignes au 2026-09-22). Un seul parcours par arbre.
describe('fins de ligne du catalogue livré', () => {
  test('mat réel -> checkmate, mat seulement forcé -> Mat en N >= 1', async () => {
    const { lineEnding } = await import('../src/core/lines.js')
    let forced = 0
    for (const o of selection) {
      const chess = new Chess()
      const moves = []
      const evals = []
      const walk = (nodes) => {
        for (const n of nodes) {
          chess.move(n.m)
          moves.push(n.m)
          evals.push(n.e ?? null)
          if (n.c?.length) walk(n.c)
          else {
            const checkmate = chess.isCheckmate()
            const ending = lineEnding({ evals, moves, side: o.side, checkmate })
            if (checkmate) expect(ending.kind).toBe('checkmate')
            else if (ending.kind === 'mate') { forced++; expect(ending.mateIn).toBeGreaterThanOrEqual(1) }
          }
          chess.undo()
          moves.pop()
          evals.pop()
        }
      }
      walk(load(`${CATALOG}trees/${o.id}.json`).tree)
    }
    expect(forced).toBe(11)
  }, 30000) // ~12 000 positions rejouées : dépasse les 5 s par défaut sur une machine chargée
})

// Catalogue complet développé (ADR-0006) : chaque ouverture hors sélection a son entrée d'index, ses
// 2 fichiers et une empreinte juste ; les alias pointent vers une ouverture sélectionnée aux mêmes
// coups et au même camp. Contrôle complet des clés sur 1 ouverture sur 25, plus Fool's Mate.
describe('catalogue complet développé', () => {
  const openings = JSON.parse(readFileSync(`${CATALOG}openings.json`, 'utf8'))
  const index = load(`${CATALOG}full-index.json`)
  const FULL = new URL('../public/catalog-full/', import.meta.url).pathname
  const selectionByKey = new Map(selection.map((s) => [`${s.side}|${s.moves.join(' ')}`, s.id]))

  test('1 entrée par ouverture, alias exacts, fichiers et empreintes justes', () => {
    expect(index).not.toBeNull()
    const problems = []
    for (const o of openings) {
      const e = index.entries[o.id]
      const aliasId = selectionByKey.get(`${o.side}|${o.moves.join(' ')}`)
      if (!e) { problems.push(`${o.id} : absente de l'index`); continue }
      if (aliasId) {
        if (e.alias !== aliasId) problems.push(`${o.id} : alias ${e.alias} au lieu de ${aliasId}`)
        const aliasTree = load(`${CATALOG}trees/${aliasId}.json`)
        if (e.difficulty !== difficulty(aliasTree.header.metrics)) problems.push(`${o.id} : difficulté périmée`)
        continue
      }
      const treeText = readFileSync(`${FULL}trees/${o.id}.json`, 'utf8')
      const hash = createHash('sha1').update(treeText).update(readFileSync(`${FULL}explain/${o.id}.json`)).digest('hex').slice(0, 8)
      if (hash !== e.hash) problems.push(`${o.id} : empreinte ${e.hash} au lieu de ${hash}`)
      const { header, tree } = JSON.parse(treeText)
      if (header.side !== o.side || header.metrics.lines !== e.lines) problems.push(`${o.id} : camp ou lignes divergents`)
      if (e.difficulty !== difficulty(header.metrics)) problems.push(`${o.id} : difficulté périmée`)
      if (!hasPath(tree, o.moves)) problems.push(`${o.id} : ligne de définition incomplète`)
    }
    expect(problems).toEqual([])
    expect(new Set(Object.values(index.entries).map((e) => e.difficulty))).toEqual(new Set([1, 2, 3, 4, 5]))
  }, 60000)

  test('échantillon : arbre qui part des coups de l\'ouverture, 1 explication par coup', () => {
    const sample = openings.filter((o, i) => index.entries[o.id]?.hash && (i % 25 === 0 || o.id === 'barnes-opening-fool-s-mate'))
    expect(sample.length).toBeGreaterThan(100)
    for (const o of sample) {
      const { tree } = load(`${FULL}trees/${o.id}.json`)
      const explain = load(`${FULL}explain/${o.id}.json`)
      const keys = treeKeys(tree)
      expect(keys.filter((k) => !explain.nodes[k])).toEqual([])
      expect(keys).toContain(replaySan(o.moves))
    }
  }, 60000)
})

// L'arbre contient-il la ligne qui définit l'ouverture en entier (dernier coup compris) ?
function hasPath(tree, moves) {
  let nodes = tree
  for (const [i, san] of moves.entries()) {
    const node = nodes?.find((n) => n.m === san)
    if (!node) return false
    if (i === moves.length - 1) return true
    nodes = node.c
  }
  return moves.length === 0
}

// Clé 15.2 des coups d'une ouverture (SAN rejoués par chess.js, suffixes +/# compris).
function replaySan(moves) {
  const chess = new Chess()
  return moves.map((m) => chess.move(m).san).join(' ')
}
