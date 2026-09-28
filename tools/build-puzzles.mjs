// Sélection déterministe d'un kit hors ligne depuis l'export CC0 Lichess.
// Usage : bun tools/build-puzzles.mjs [chemin vers lichess_db_puzzle.csv.zst]
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'
import { eligibleMateControl, mateMoves, puzzleStart } from '../src/core/puzzles.js'

const SOURCE = resolve(process.argv[2] || 'tools/data/lichess_db_puzzle.csv.zst')
const OUTPUT = resolve('public/packs/puzzles-2026-09.json')
const INDEX = resolve('public/packs/index.json')
const HEAD = 'PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate'
const CATEGORY = ['attack', 'defense', 'technique', 'tactics']
const TARGETS = { core: 2000, low: 300, high: 500 }
const sourceHash = createHash('sha256')
for await (const chunk of createReadStream(SOURCE)) sourceHash.update(chunk)

function catOf(themes) {
  if (themes.some((t) => t === 'mate' || /^mateIn\d+$/.test(t) || /Attack$/.test(t) || t === 'exposedKing' || t === 'doubleCheck')) return 'attack'
  if (themes.includes('defensiveMove') || themes.includes('equality')) return 'defense'
  if (themes.some((t) => t === 'endgame' || /Endgame$/.test(t) || ['promotion', 'zugzwang'].includes(t))) return 'technique'
  return 'tactics'
}
const scoreOf = (id) => createHash('sha1').update(id).digest().readUInt32BE(0)
function bucketOf(rating) {
  if (rating < 600) return 'low'
  if (rating <= 1400) return 'core'
  return 'high'
}
const buckets = Object.fromEntries(CATEGORY.flatMap((cat) => Object.keys(TARGETS).map((band) => [`${cat}:${band}`, []])))
const counts = Object.fromEntries(Object.keys(buckets).map((key) => [key, 0]))
const mate1 = []
const mate2 = []
function keep(list, target, item) {
  list.push(item)
  if (list.length > target * 3) {
    list.sort((a, b) => a.score - b.score || a.puzzle.id.localeCompare(b.puzzle.id))
    list.length = target
  }
}
function validPuzzle(puzzle) {
  try {
    const chess = new Chess(puzzle.fen)
    for (const uci of puzzle.moves) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return false
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      if (!move) return false
    }
    return true
  } catch { return false }
}

const decoder = spawn('zstd', ['-dc', SOURCE], { stdio: ['ignore', 'pipe', 'pipe'] })
const decoderExit = new Promise((resolve) => decoder.on('close', resolve))
let decoderError = ''
decoder.stderr.on('data', (chunk) => { decoderError += chunk.toString() })
const lines = createInterface({ input: decoder.stdout, crlfDelay: Infinity })
let first = true
let scanned = 0
for await (const line of lines) {
  if (first) {
    if (line !== HEAD) throw new Error('En-tête CSV inattendu')
    first = false
    continue
  }
  scanned++
  const fields = line.split(',')
  if (fields.length !== 11) throw new Error(`CSV inattendu, ligne ${scanned + 1}`)
  const [id, fen, rawMoves, rawRating, rawDeviation, rawPopularity, rawPlays, rawThemes, , rawOpenings] = fields
  const rating = Number(rawRating)
  if (rating < 400 || rating > 1800 || Number(rawDeviation) > 90 || Number(rawPopularity) < 85 || Number(rawPlays) < 500) continue
  const themes = rawThemes.split(' ').filter(Boolean)
  const cat = catOf(themes)
  const band = bucketOf(rating)
  const key = `${cat}:${band}`
  counts[key]++
  const puzzle = {
    id: `lichess:${id}@2026-09`, fen, moves: rawMoves.split(' '), rating, themes,
    openings: rawOpenings.split(' ').filter(Boolean), cat,
  }
  const item = { score: scoreOf(id), puzzle }
  keep(buckets[key], TARGETS[band], item)
  if (rating >= 600 && rating <= 1400 && themes.includes('mateIn1')) keep(mate1, 500, item)
  if (rating >= 600 && rating <= 1400 && themes.includes('mateIn2')) keep(mate2, 200, item)
}
const decoderCode = await decoderExit
if (decoderCode !== 0) throw new Error(`Décompression échouée : ${decoderError.trim()}`)
for (const cat of CATEGORY) {
  if (counts[`${cat}:core`] < 300) throw new Error(`Couverture insuffisante : ${cat}`)
}
const selected = new Map()
for (const [key, list] of Object.entries(buckets)) {
  const target = TARGETS[key.split(':')[1]]
  for (const item of list.sort((a, b) => a.score - b.score).slice(0, target)) selected.set(item.puzzle.id, item.puzzle)
}
for (const item of mate1.sort((a, b) => a.score - b.score).slice(0, 500)) selected.set(item.puzzle.id, item.puzzle)
for (const item of mate2.sort((a, b) => a.score - b.score).slice(0, 125)) selected.set(item.puzzle.id, item.puzzle)
const puzzles = [...selected.values()].filter(validPuzzle).sort((a, b) => a.id.localeCompare(b.id))
for (const puzzle of puzzles) {
  if (puzzle.themes.includes('mateIn1') && !mateMoves(puzzleStart(puzzle).fen).length) {
    throw new Error(`Mat en 1 absent : ${puzzle.id}`)
  }
  if (puzzle.themes.includes('mateIn2') && eligibleMateControl(puzzle)) puzzle.control = true
}
if (puzzles.filter((p) => p.control).length < 100) throw new Error('Pas assez de contrôles sans mat en 1')
const coverage = Object.fromEntries(CATEGORY.map((cat) => [cat, puzzles.filter((p) => p.cat === cat && p.rating >= 600 && p.rating <= 1400).length]))
for (const [cat, n] of Object.entries(coverage)) if (n < 300) throw new Error(`Kit insuffisant après validation : ${cat} ${n}`)
const output = { header: { version: '2026-09', source: 'lichess_db_puzzle.csv.zst', sourceSha256: sourceHash.digest('hex'), scanned, coverage }, puzzles }
const content = JSON.stringify(output)
mkdirSync(resolve('public/packs'), { recursive: true })
writeFileSync(OUTPUT, content)
const complements = (() => { try { return JSON.parse(readFileSync(INDEX)).packs.filter((pack) => pack.file !== 'puzzles-2026-09.json') } catch { return [] } })()
writeFileSync(INDEX, JSON.stringify({ version: complements.length ? '2026-10' : '2026-09', packs: [{ file: 'puzzles-2026-09.json', bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), count: puzzles.length }, ...complements] }))
console.log(JSON.stringify({ file: OUTPUT, total: puzzles.length, controls: puzzles.filter((p) => p.control).length, coverage, counts }, null, 2))
