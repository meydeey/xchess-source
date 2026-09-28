#!/usr/bin/env bun
// Génère catalog/trees/<id>.json pour une ou plusieurs ouvertures de catalog/selection.json, ou
// une ouverture ad-hoc hors sélection, via src/generator/index.js (moteur + explorateur + études).
// Tranche débutant (spec 14.2 : ratings 0,1000). Token Lichess : lancer via `infisical run`.
//
// Usage :
//   bun run trees -- --all
//   bun run trees -- --id partie-italienne,gambit-stafford
//   bun run trees -- --id alien-gambit --force
//   bun run trees -- --opening '{"id":"x","name":"X","side":"white","moves":["e4"]}' --out tools/cache/pilot
//   (--opening est répétable : plusieurs ouvertures hors sélection sur un même pool partagé)
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { Chess } from 'chess.js'
import { generateTree } from '../src/generator/index.js'
import { EnginePool, cachedEngine } from './lib/uci-engine.mjs'
import { createExplorer } from './lib/explorer.mjs'

const BAND_DEBUTANT = { id: 'debutant', ratings: [0, 1000] } // src/core/metrics.js BANDS.debutant

function parseArgs(argv) {
  const args = { id: null, all: false, openings: null, out: null, force: false, concurrency: 3, engines: null, threads: 3 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') args.all = true
    else if (a === '--force') args.force = true
    else if (a === '--id') args.id = argv[++i].split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--opening') (args.openings ||= []).push(JSON.parse(argv[++i])) // répétable : une ouverture par occurrence
    else if (a === '--out') args.out = argv[++i]
    else if (a === '--concurrency') args.concurrency = Number(argv[++i])
    else if (a === '--engines') args.engines = Number(argv[++i])
    else if (a === '--threads') args.threads = Number(argv[++i])
    else throw new Error(`argument inconnu : ${a}`)
  }
  return args
}

// Fusionne les études PGN d'un dossier par position (les transpositions partagent leurs coups),
// même logique que l'ancien tools/build-tree.mjs. Renvoie null si le dossier n'existe pas.
function loadStudies(dir) {
  if (!existsSync(dir)) return null
  const key = (fen) => fen.split(' ').slice(0, 4).join(' ')
  const studyMoves = new Map()
  const add = (fen, san) => {
    const k = key(fen)
    if (!studyMoves.has(k)) studyMoves.set(k, new Set())
    studyMoves.get(k).add(san)
  }
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.pgn')) continue
    const text = readFileSync(`${dir}/${file}`, 'utf8')
    for (const game of text.split(/\n(?=\[Event )/)) {
      const moveText = game.split('\n').filter((l) => !l.startsWith('[')).join(' ').replace(/\{[^}]*\}/g, ' ').replace(/\$\d+/g, ' ')
      const tokens = moveText.match(/\(|\)|[^\s()]+/g) || []
      const stack = []
      let state = { fen: new Chess().fen(), before: null }
      for (let t of tokens) {
        if (t === '(') { stack.push(state); state = { fen: state.before, before: null }; continue }
        if (t === ')') { state = stack.pop(); continue }
        t = t.replace(/^\d+\.+/, '').replace(/[!?]+$/, '')
        if (!t || ['*', '1-0', '0-1', '1/2-1/2'].includes(t)) continue
        try {
          const c = new Chess(state.fen)
          const mv = c.move(t)
          add(state.fen, mv.san)
          state = { fen: c.fen(), before: state.fen }
        } catch {
          console.warn(`études : coup illégal "${t}" ignoré dans ${file}`)
        }
      }
    }
  }
  return studyMoves
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = (args.out || new URL('../catalog/trees/', import.meta.url).pathname).replace(/\/$/, '')
  mkdirSync(outDir, { recursive: true })

  let openings
  if (args.openings) {
    openings = args.openings
  } else {
    const selectionPath = new URL('../catalog/selection.json', import.meta.url).pathname
    if (!existsSync(selectionPath)) {
      throw new Error("catalog/selection.json introuvable : utiliser --opening '<json>' pour une ouverture hors sélection")
    }
    const selection = JSON.parse(readFileSync(selectionPath, 'utf8'))
    if (args.all) openings = selection
    else if (args.id) {
      openings = selection.filter((o) => args.id.includes(o.id))
      const missing = args.id.filter((id) => !openings.some((o) => o.id === id))
      if (missing.length) throw new Error(`ids introuvables dans la sélection : ${missing.join(', ')}`)
    } else throw new Error("indiquer --all, --id a,b,c ou --opening '<json>'")
  }

  const toGenerate = []
  for (const opening of openings) {
    const outFile = `${outDir}/${opening.id}.json`
    if (existsSync(outFile) && !args.force) {
      console.log(`- ${opening.id} : arbre existant, ignoré (--force pour régénérer)`)
      continue
    }
    toGenerate.push({ opening, outFile })
  }
  if (!toGenerate.length) { console.log('rien à générer.'); return }

  const pool = new EnginePool({ size: args.engines || Math.max(1, args.concurrency), threads: args.threads })
  const engine = cachedEngine(pool)
  const explorer = createExplorer()
  const studiesByOpening = { 'alien-gambit': loadStudies(new URL('./studies/alien-gambit/', import.meta.url).pathname) }

  async function generateOne({ opening, outFile }) {
    const t0 = Date.now()
    const studies = studiesByOpening[opening.id] || null
    const { header, tree } = await generateTree(opening, {
      engine, explorer, studies, band: BAND_DEBUTANT,
      params: { engine: 'Stockfish 19' },
      onProgress: ({ positions, lines }) => {
        if (positions % 50 === 0) console.log(`  [${opening.id}] ${positions} positions, ${lines} lignes...`)
      },
    })
    writeFileSync(outFile, JSON.stringify({ header, tree }))
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`- ${opening.id} : ${header.metrics.positions} positions, ${header.metrics.lines} lignes, ${elapsed}s -> ${outFile}`)
  }

  const t0 = Date.now()
  let cursor = 0
  async function worker() {
    while (cursor < toGenerate.length) await generateOne(toGenerate[cursor++])
  }
  await Promise.all(Array.from({ length: Math.min(args.concurrency, toGenerate.length) }, worker))
  console.log(`terminé : ${toGenerate.length} arbre(s) en ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  pool.close()
}

await main()
