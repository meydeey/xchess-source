// Validate every prepared position and obtain a playable witness against full-strength Stockfish.
// --write stores the resulting proof; ordinary verification never changes the season.
import { readFileSync, writeFileSync } from 'node:fs'
import { Chess } from 'chess.js'
import { UciEngine } from './lib/uci-engine.mjs'
import { playUci } from '../src/core/puzzles.js'
import { evaluateDuel } from '../src/core/adventure.js'
const path = new URL('../catalog/adventure-season-1.json', import.meta.url)
const season = JSON.parse(readFileSync(path, 'utf8'))
const engine = await new UciEngine(undefined, { threads: 2, hash: 64 }).init()
try {
  for (const encounter of season.encounters) {
    const chess = new Chess(encounter.duel.initialFen)
    if (encounter.opening) {
      const opening = new Chess()
      for (const move of encounter.opening.continuation) opening.move(move)
      if (opening.fen() !== chess.fen()) throw new Error(`Opening mismatch: ${encounter.id}`)
    }
    const moves = [], evaluations = []
    let outcome
    for (let round = 0; round < 6; round++) {
      const own = round === 0 ? encounter.duel.firstMove : (await engine.analyse(chess.fen(), { depth: 12, movetime: 500 }))[0]?.uci
      if (!playUci(chess, own)) throw new Error(`Illegal player move: ${encounter.id} ${own}`)
      moves.push(own)
      if (!chess.isGameOver()) {
        const reply = (await engine.analyse(chess.fen(), { depth: 12, movetime: 500 }))[0]?.uci
        if (!playUci(chess, reply)) throw new Error(`Illegal engine reply: ${encounter.id} ${reply}`)
        moves.push(reply)
      }
      const score = chess.isGameOver() ? null : (await engine.analyse(chess.fen(), { depth: 12, movetime: 500 }))[0]?.score
      if (Number.isFinite(score)) evaluations.push(score)
      outcome = evaluateDuel({ initialFen: encounter.duel.initialFen, moves, evaluations, score, side: encounter.side, goal: encounter.goal })
      if (outcome.status === 'won' || outcome.status === 'lost') break
    }
    if (outcome?.status !== 'won') throw new Error(`Objective not reached: ${encounter.id} ${JSON.stringify({ outcome, moves, evaluations })}`)
    encounter.duel.witness = { moves, evaluations, verified: '2026-10-18', engine: 'Stockfish', depth: 12, movetime: 500 }
    console.log(`${encounter.id}: ${outcome.reason}, ${outcome.rounds} moves, gain ${outcome.gain}, ${evaluations.at(-1) ?? 'mate/draw'} cp (White)`)
  }
  if (process.argv.includes('--write')) writeFileSync(path, JSON.stringify(season, null, 2) + '\n')
} finally { engine.quit() }
