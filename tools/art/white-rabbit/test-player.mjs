// A full-strength player for isolated UI checks; never included in the application.
import { createInterface } from 'node:readline'
import { UciEngine } from '../../lib/uci-engine.mjs'
import { restoreDuel } from '../../../src/core/adventure.js'
import { playUci } from '../../../src/core/puzzles.js'
const engine = await new UciEngine(undefined, { threads: 2, hash: 32 }).init()
try {
  for await (const line of createInterface({ input: process.stdin })) {
    try {
      const data = JSON.parse(line)
      const chess = restoreDuel(data)
      let uci = data.preferred
      if (data.mode === 'avoid') {
        const moves = chess.moves({ verbose: true }).filter((move) => { const candidate = restoreDuel(data); candidate.move(move); return !candidate.isCheckmate() })
        const cost = (move) => (move.captured ? 10 : 0) + (move.promotion ? 20 : 0) + ({ k: 0, b: 1, n: 1, p: 2, r: 3, q: 4 }[move.piece])
        const move = moves.sort((a,b) => cost(a) - cost(b))[0]
        uci = move && move.from + move.to + (move.promotion || '')
      }
      if (!uci || !playUci(restoreDuel(data), uci)) uci = (await engine.analyse(chess.fen(), { depth: 12, movetime: 500 }))[0]?.uci
      process.stdout.write(JSON.stringify({ uci }) + '\n')
    } catch (error) { process.stdout.write(JSON.stringify({ error: error.message }) + '\n') }
  }
} finally { engine.quit() }
