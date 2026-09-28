// Complément déterministe du kit débutant. Ne réécrit aucun identifiant historique.
// Usage : bun tools/build-puzzles-motifs.mjs [export Lichess .csv.zst]
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { Chess } from 'chess.js'

const SOURCE = resolve(process.argv[2] || 'tools/data/lichess_db_puzzle.csv.zst')
const OUTPUT = resolve('public/packs/puzzles-motifs-2026-10.json')
const INDEX = resolve('public/packs/index.json')
const VERSION = '2026-10'
const THEMES = ['fork', 'pin', 'hangingPiece', 'defensiveMove', 'mateIn1', 'mateIn2', 'promotion', 'endgame', 'skewer', 'discoveredAttack']
const existing = ['puzzles-2026-09.json', 'puzzles-advanced-2026-10.json']
  .flatMap((file) => JSON.parse(readFileSync(resolve(`public/packs/${file}`))).puzzles)
const oldIds = new Set(existing.map((p) => p.id.split('@')[0]))
const oldCoverage = Object.fromEntries(THEMES.map((theme) => [theme, existing.filter((p) => p.themes.includes(theme)).length]))
const scoreOf = (id) => createHash('sha1').update(id).digest().readUInt32BE(0)
const candidate = new Map()
const sourceHash = createHash('sha256')
for await (const chunk of createReadStream(SOURCE)) sourceHash.update(chunk)

function keep(list, item, limit) {
  list.push(item)
  if (list.length > limit * 2) {
    list.sort((a, b) => a.score - b.score || a.puzzle.id.localeCompare(b.puzzle.id))
    list.length = limit
  }
}
const themeLists = Object.fromEntries(THEMES.map((t) => [t, []]))
const general = []
const decoder = spawn('zstd', ['-dc', SOURCE], { stdio: ['ignore', 'pipe', 'pipe'] })
let decoderError = ''
decoder.stderr.on('data', (chunk) => { decoderError += chunk.toString() })
const decoderExit = new Promise((done) => decoder.on('close', done))
let first = true
for await (const line of createInterface({ input: decoder.stdout, crlfDelay: Infinity })) {
  if (first) { first = false; continue }
  const fields = line.split(',')
  if (fields.length !== 11) continue
  const [id, fen, rawMoves, rawRating, rawDeviation, rawPopularity, rawPlays, rawThemes, , rawOpenings] = fields
  const rating = Number(rawRating)
  if (rating < 400 || rating > 1800 || Number(rawDeviation) > 90 || Number(rawPopularity) < 85 || Number(rawPlays) < 500 || oldIds.has(`lichess:${id}`)) continue
  const themes = rawThemes.split(' ').filter(Boolean)
  const cat = themes.some((t) => t === 'mate' || /^mateIn\d+$/.test(t) || /Attack$/.test(t) || t === 'exposedKing' || t === 'doubleCheck') ? 'attack'
    : themes.includes('defensiveMove') || themes.includes('equality') ? 'defense'
      : themes.some((t) => t === 'endgame' || /Endgame$/.test(t) || ['promotion', 'zugzwang'].includes(t)) ? 'technique' : 'tactics'
  const item = { score: scoreOf(id), puzzle: { id: `lichess:${id}@${VERSION}`, fen, moves: rawMoves.split(' '), rating, themes, openings: rawOpenings.split(' ').filter(Boolean), cat } }
  keep(general, item, 5000)
  for (const theme of THEMES) if (themes.includes(theme)) keep(themeLists[theme], item, 600)
}
if (await decoderExit !== 0) throw new Error(`Décompression échouée : ${decoderError.trim()}`)

function valid(p) {
  try {
    const chess = new Chess(p.fen)
    for (const [index, uci] of p.moves.entries()) {
      if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return false
      if (!chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })) return false
      if (index === 1 && p.themes.includes('mateIn1') && !chess.isCheckmate()) return false
    }
    return true
  } catch { return false }
}
function add(item) {
  if (candidate.has(item.puzzle.id) || !valid(item.puzzle)) return
  candidate.set(item.puzzle.id, item.puzzle)
}
for (const theme of THEMES) {
  const need = Math.max(0, 500 - oldCoverage[theme])
  let added = 0
  for (const item of themeLists[theme].sort((a, b) => a.score - b.score || a.puzzle.id.localeCompare(b.puzzle.id))) {
    const wasNew = !candidate.has(item.puzzle.id)
    add(item)
    if (wasNew && candidate.has(item.puzzle.id)) added++
    if (added >= need) break
  }
}
for (const item of general.sort((a, b) => a.score - b.score || a.puzzle.id.localeCompare(b.puzzle.id))) {
  if (candidate.size >= 3000) break
  add(item)
}
if (candidate.size < 2583) throw new Error(`Complément insuffisant : ${candidate.size}`)
const puzzles = [...candidate.values()].sort((a, b) => a.id.localeCompare(b.id))
const coverage = Object.fromEntries(THEMES.map((theme) => [theme, oldCoverage[theme] + puzzles.filter((p) => p.themes.includes(theme)).length]))
if (Object.values(coverage).some((n) => n < 500)) throw new Error(`Couverture insuffisante : ${JSON.stringify(coverage)}`)
const content = JSON.stringify({ header: { version: VERSION, source: 'lichess_db_puzzle.csv.zst', sourceSha256: sourceHash.digest('hex'), coverage }, puzzles })
writeFileSync(OUTPUT, content)
const index = JSON.parse(readFileSync(INDEX))
index.version = VERSION
index.packs = [index.packs[0], { file: 'puzzles-motifs-2026-10.json', bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'), count: puzzles.length }, ...index.packs.filter((p) => p.minRating)]
writeFileSync(INDEX, JSON.stringify(index))
console.log(JSON.stringify({ added: puzzles.length, total: index.packs.reduce((sum, p) => sum + p.count, 0), coverage }))
