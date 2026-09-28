#!/usr/bin/env bun
// Génère catalog/explain/<id>.json pour chaque arbre de catalog/trees/, via src/explain/index.js
// (moteur + explorateur). Tranche débutant (spec 14.2 : ratings 0,1000), comme tools/build-trees.mjs.
// Token Lichess : lancer via `infisical run --env=dev --silent -- bun tools/build-explanations.mjs`
// (script npm `explain`, package.json).
//
// Usage :
//   bun run explain
//   bun run explain -- --id alien-gambit,gambit-stafford
//   bun run explain -- --id alien-gambit --force
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { explainTree } from '../src/explain/index.js'
import { EnginePool, cachedEngine } from './lib/uci-engine.mjs'
import { createExplorer } from './lib/explorer.mjs'

const BAND_DEBUTANT = { id: 'debutant', ratings: [0, 1000] } // src/core/metrics.js BANDS.debutant
const TREES_DIR = new URL('../catalog/trees/', import.meta.url).pathname
const EXPLAIN_DIR = new URL('../catalog/explain/', import.meta.url).pathname
const SELECTION_PATH = new URL('../catalog/selection.json', import.meta.url).pathname
const OPENINGS_PATH = new URL('../catalog/openings.json', import.meta.url).pathname

function parseArgs(argv) {
  const args = { id: null, force: false, concurrency: 3, engines: null, threads: 3 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--force') args.force = true
    else if (a === '--id') args.id = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--concurrency') args.concurrency = Number(argv[++i])
    else if (a === '--engines') args.engines = Number(argv[++i])
    else if (a === '--threads') args.threads = Number(argv[++i])
    else throw new Error(`argument inconnu : ${a}`)
  }
  return args
}

// L'arbre (catalog/trees/<id>.json) ne porte pas les coups qui définissent l'ouverture (14.3 : le
// header n'a ni `moves` ni `definingMoves`) : on les cherche dans la sélection, puis dans le
// catalogue complet, par id (même ordre que resolveOpening de src/ui/shared.js).
function findOpeningMeta(id) {
  if (existsSync(SELECTION_PATH)) {
    const selection = JSON.parse(readFileSync(SELECTION_PATH, 'utf8'))
    const hit = selection.find((o) => o.id === id)
    if (hit) return { side: hit.side, moves: hit.moves }
  }
  if (existsSync(OPENINGS_PATH)) {
    const openings = JSON.parse(readFileSync(OPENINGS_PATH, 'utf8'))
    const hit = openings.find((o) => o.id === id)
    if (hit) return { side: hit.side, moves: hit.moves }
  }
  return null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(EXPLAIN_DIR, { recursive: true })

  if (!existsSync(TREES_DIR)) throw new Error(`catalog/trees/ introuvable`)
  let ids = readdirSync(TREES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
  if (args.id) {
    const missing = args.id.filter((id) => !ids.includes(id))
    if (missing.length) throw new Error(`arbres introuvables dans catalog/trees/ : ${missing.join(', ')}`)
    ids = args.id
  }

  const toGenerate = []
  for (const id of ids) {
    const outFile = `${EXPLAIN_DIR}${id}.json`
    if (existsSync(outFile) && !args.force) {
      console.log(`- ${id} : explications existantes, ignoré (--force pour régénérer)`)
      continue
    }
    const meta = findOpeningMeta(id)
    if (!meta) {
      console.warn(`- ${id} : ouverture introuvable dans selection.json ou openings.json, ignoré`)
      continue
    }
    toGenerate.push({ id, outFile, meta })
  }
  if (!toGenerate.length) { console.log('rien à générer.'); return }

  const pool = new EnginePool({ size: args.engines || Math.max(1, args.concurrency), threads: args.threads })
  const engine = cachedEngine(pool)
  const explorer = createExplorer()

  async function generateOne({ id, outFile, meta }) {
    const t0 = Date.now()
    const treeFile = `${TREES_DIR}${id}.json`
    const { tree } = JSON.parse(readFileSync(treeFile, 'utf8'))
    let lastLog = 0
    const { header, nodes } = await explainTree(
      { tree, side: meta.side, definingMoves: meta.moves, id },
      {
        engine, explorer, band: BAND_DEBUTANT,
        onProgress: ({ done, total }) => {
          if (done - lastLog >= 50 || done === total) { lastLog = done; console.log(`  [${id}] ${done}/${total} nœuds expliqués...`) }
        },
      },
    )
    writeFileSync(outFile, JSON.stringify({ header, nodes }))
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`- ${id} : ${Object.keys(nodes).length} explications, ${elapsed}s -> ${outFile}`)
  }

  const t0 = Date.now()
  let cursor = 0
  async function worker() {
    while (cursor < toGenerate.length) await generateOne(toGenerate[cursor++])
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, toGenerate.length) }, worker))
  console.log(`terminé : ${toGenerate.length} arbre(s) expliqué(s) en ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  pool.close()
}

await main()
