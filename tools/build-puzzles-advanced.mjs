// Kit complémentaire haut niveau, sans changer les identifiants du pack historique.
// Usage : bun tools/build-puzzles-advanced.mjs [export Lichess .csv.zst]
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'

const SOURCE = resolve(process.argv[2] || 'tools/data/lichess_db_puzzle.csv.zst')
const OUTPUT = resolve('public/packs/puzzles-advanced-2026-10.json')
const INDEX = resolve('public/packs/index.json')
const VERSION = '2026-10'
const CATEGORIES = ['attack', 'defense', 'technique', 'tactics']
const BANDS = [[1700, 1899], [1900, 2199], [2200, 2499], [2500, 2799]]
const TARGET = 180
const base = JSON.parse(readFileSync(resolve('public/packs/puzzles-2026-09.json')))
const oldIds = new Set(base.puzzles.map((p) => p.id.split('@')[0]))
const scoreOf = (id) => createHash('sha1').update(id).digest().readUInt32BE(0)
const bucket = new Map(CATEGORIES.flatMap((cat) => BANDS.map(([min]) => [`${cat}:${min}`, []])))
const sourceHash = createHash('sha256')
for await (const chunk of createReadStream(SOURCE)) sourceHash.update(chunk)

function category(themes) {
  if (themes.some((t) => t === 'mate' || /^mateIn\d+$/.test(t) || /Attack$/.test(t) || t === 'exposedKing' || t === 'doubleCheck')) return 'attack'
  if (themes.includes('defensiveMove') || themes.includes('equality')) return 'defense'
  if (themes.some((t) => t === 'endgame' || /Endgame$/.test(t) || ['promotion', 'zugzwang'].includes(t))) return 'technique'
  return 'tactics'
}

function valid(puzzle) {
  try {
    const chess = new Chess(puzzle.fen)
    for (const uci of puzzle.moves) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return false
      if (!chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })) return false
    }
    return true
  } catch { return false }
}

const decoder = spawn('zstd', ['-dc', SOURCE], { stdio: ['ignore', 'pipe', 'pipe'] })
const exit = new Promise((resolveExit) => decoder.on('close', resolveExit))
let error = ''
decoder.stderr.on('data', (chunk) => { error += chunk.toString() })
let first = true
for await (const line of createInterface({ input: decoder.stdout, crlfDelay: Infinity })) {
  if (first) { first = false; continue }
  const fields = line.split(',')
  if (fields.length !== 11) continue
  const [id, fen, rawMoves, rawRating, rawDeviation, rawPopularity, rawPlays, rawThemes, , rawOpenings] = fields
  const rating = Number(rawRating)
  if (rating < 1700 || rating >= 2800 || Number(rawDeviation) > 90 || Number(rawPopularity) < 85 || Number(rawPlays) < 500 || oldIds.has(`lichess:${id}`)) continue
  const themes = rawThemes.split(' ').filter(Boolean)
  const cat = category(themes)
  const band = BANDS.find(([min, max]) => rating >= min && rating <= max)
  const list = bucket.get(`${cat}:${band[0]}`)
  list.push({ score: scoreOf(id), puzzle: { id: `lichess:${id}@${VERSION}`, fen, moves: rawMoves.split(' '), rating, themes, openings: rawOpenings.split(' ').filter(Boolean), cat } })
  if (list.length > TARGET * 3) { list.sort((a, b) => a.score - b.score || a.puzzle.id.localeCompare(b.puzzle.id)); list.length = TARGET }
}
if (await exit !== 0) throw new Error(`Décompression échouée : ${error}`)
const puzzles = []
for (const [key, list] of bucket) {
  const selected = list.sort((a, b) => a.score - b.score || a.puzzle.id.localeCompare(b.puzzle.id)).slice(0, TARGET).map((x) => x.puzzle).filter(valid)
  if (selected.length < 100) throw new Error(`Couverture insuffisante : ${key} (${selected.length})`)
  puzzles.push(...selected)
}
puzzles.sort((a, b) => a.id.localeCompare(b.id))
const coverage = Object.fromEntries(bucket.keys().map((key) => [key, puzzles.filter((p) => `${p.cat}:${BANDS.find(([min, max]) => p.rating >= min && p.rating <= max)[0]}` === key).length]))
const content = JSON.stringify({ header: { version: VERSION, source: 'lichess_db_puzzle.csv.zst', sourceSha256: sourceHash.digest('hex'), coverage }, puzzles })
writeFileSync(OUTPUT, content)
const index = JSON.parse(readFileSync(INDEX))
index.version = VERSION
index.packs = [index.packs[0], ...index.packs.filter((p) => p.file.startsWith('puzzles-motifs-')), { file: 'puzzles-advanced-2026-10.json', bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), count: puzzles.length, minRating: 1700 }]
writeFileSync(INDEX, JSON.stringify(index))
console.log(JSON.stringify({ count: puzzles.length, coverage }))
