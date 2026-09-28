#!/usr/bin/env bun
// Développe tout le catalogue complet (ADR-0006) : pour chaque ouverture de catalog/openings.json hors
// sélection, un arbre et ses explications en mode app (Stockfish seul, sans explorateur ni token,
// mêmes réglages que le bouton « Générer l'arbre » de l'app Mac), écrits dans public/catalog-full/,
// servis à la demande par le site et l'app. Puis l'index catalog/full-index.json, embarqué dans le
// bundle : lignes, difficulté et empreinte de chaque ouverture, ou alias vers la sélection quand
// l'ouverture a exactement les mêmes coups et le même camp qu'une ouverture sélectionnée.
//
// Usage :
//   bun run full-catalog                      toutes les ouvertures sans fichiers, puis l'index
//   bun run full-catalog -- --id a,b --force  régénère des ouvertures précises
//   bun run full-catalog -- --index-only      réécrit l'index depuis les fichiers présents
//   options : --engines 8 (moteurs en parallèle, 1 thread chacun), --limit N
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { generateTree, DEFAULT_PARAMS } from '../src/generator/index.js'
import { explainTree } from '../src/explain/index.js'
import { difficulty } from '../src/core/metrics.js'
import { APP_GENERATE_PARAMS } from '../src/ui/generate.js'
import { EnginePool, cachedEngine } from './lib/uci-engine.mjs'

const BAND_DEBUTANT = { id: 'debutant', ratings: [0, 1000] } // src/core/metrics.js BANDS.debutant
const ROOT = new URL('../', import.meta.url).pathname
const OUT = `${ROOT}public/catalog-full/`
const INDEX_PATH = `${ROOT}catalog/full-index.json`
const INDEX_EVERY = 100 // l'index se réécrit en cours de route : un lot interrompu reste utilisable

function parseArgs(argv) {
  const args = { id: null, force: false, engines: 8, limit: Infinity, indexOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') args.force = true
    else if (a === '--index-only') args.indexOnly = true
    else if (a === '--id') args.id = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--engines') args.engines = Number(argv[++i])
    else if (a === '--limit') args.limit = Number(argv[++i])
    else throw new Error(`argument inconnu : ${a}`)
  }
  return args
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const keyOf = (o) => `${o.side}|${o.moves.join(' ')}`
const treePath = (id) => `${OUT}trees/${id}.json`
const explainPath = (id) => `${OUT}explain/${id}.json`

// Index : { version, generatedAt, entries: { [id]: { lines, difficulty, hash } | { alias, lines,
// difficulty } } }. `hash` (8 caractères hexadécimaux des 2 fichiers) part dans l'URL de chargement :
// une ouverture régénérée change d'URL, le cache du service worker ne sert jamais l'ancienne version.
function writeIndex(openings, aliasOf) {
  const entries = {}
  for (const o of openings) {
    if (aliasOf.has(o.id)) {
      const alias = aliasOf.get(o.id)
      const { header } = readJson(`${ROOT}catalog/trees/${alias}.json`)
      entries[o.id] = { alias, lines: header.metrics.lines, difficulty: difficulty(header.metrics) }
      continue
    }
    if (!existsSync(treePath(o.id)) || !existsSync(explainPath(o.id))) continue
    const treeText = readFileSync(treePath(o.id), 'utf8')
    const { header } = JSON.parse(treeText)
    const hash = createHash('sha1').update(treeText).update(readFileSync(explainPath(o.id))).digest('hex').slice(0, 8)
    entries[o.id] = { lines: header.metrics.lines, difficulty: difficulty(header.metrics), hash }
  }
  writeFileSync(INDEX_PATH, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), entries }))
  return Object.keys(entries).length
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const openings = readJson(`${ROOT}catalog/openings.json`)
  const selection = readJson(`${ROOT}catalog/selection.json`)
  const selectionByKey = new Map(selection.map((s) => [keyOf(s), s.id]))
  const aliasOf = new Map()
  for (const o of openings) if (selectionByKey.has(keyOf(o))) aliasOf.set(o.id, selectionByKey.get(keyOf(o)))

  mkdirSync(`${OUT}trees`, { recursive: true })
  mkdirSync(`${OUT}explain`, { recursive: true })
  if (args.indexOnly) { console.log(`index : ${writeIndex(openings, aliasOf)} entrées`); return }

  let todo = openings.filter((o) => !aliasOf.has(o.id))
  if (args.id) {
    const missing = args.id.filter((id) => !todo.some((o) => o.id === id))
    if (missing.length) throw new Error(`ids introuvables ou alias de la sélection : ${missing.join(', ')}`)
    todo = todo.filter((o) => args.id.includes(o.id))
  }
  if (!args.force) todo = todo.filter((o) => !existsSync(treePath(o.id)) || !existsSync(explainPath(o.id)))
  todo = todo.slice(0, args.limit)
  console.log(`${todo.length} ouverture(s) à développer, ${aliasOf.size} alias de la sélection`)

  const pool = new EnginePool({ size: args.engines, threads: 1 })
  const engine = cachedEngine(pool)
  const params = { ...DEFAULT_PARAMS, ...APP_GENERATE_PARAMS, engine: 'Stockfish 19' }
  const t0 = Date.now()
  let done = 0
  let failed = 0

  async function developOne(o) {
    const { header, tree } = await generateTree(o, { engine, explorer: null, studies: null, band: BAND_DEBUTANT, params })
    const explain = await explainTree(
      { tree, side: o.side, definingMoves: o.moves, id: o.id },
      { engine, explorer: null, band: BAND_DEBUTANT },
    )
    // Explications d'abord, arbre ensuite : un arbre présent garantit ses explications.
    writeFileSync(explainPath(o.id), JSON.stringify(explain))
    writeFileSync(treePath(o.id), JSON.stringify({ header, tree }))
    return header.metrics
  }

  let cursor = 0
  async function worker() {
    while (cursor < todo.length) {
      const o = todo[cursor++]
      try {
        const m = await developOne(o)
        done++
        const rate = (Date.now() - t0) / 1000 / done
        const left = Math.round(((todo.length - done - failed) * rate) / 60)
        console.log(`[${done}/${todo.length}] ${o.id} : ${m.lines} ligne(s), ${m.positions} positions, reste ~${left} min`)
      } catch (err) {
        failed++
        console.error(`ÉCHEC ${o.id} : ${err.message}`)
      }
      if ((done + failed) % INDEX_EVERY === 0) writeIndex(openings, aliasOf)
    }
  }
  await Promise.all(Array.from({ length: Math.min(args.engines, todo.length) }, worker))
  pool.close()
  const total = writeIndex(openings, aliasOf)
  console.log(`terminé : ${done} développée(s), ${failed} échec(s) en ${Math.round((Date.now() - t0) / 60000)} min ; index : ${total} entrées`)
}

await main()
