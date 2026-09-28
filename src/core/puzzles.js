import { Chess } from 'chess.js'

export const PUZZLE_MODES = ['mixed', 'attack', 'tactics', 'defense', 'technique', 'mate1']

export function playUci(chess, uci) {
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return null
  try { return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }) }
  catch { return null }
}

export function puzzleStart(puzzle) {
  const chess = new Chess(puzzle.fen)
  const last = playUci(chess, puzzle.moves[0])
  if (!last) throw new Error(`Exercice invalide : ${puzzle.id}`)
  return { fen: chess.fen(), side: chess.turn() === 'w' ? 'white' : 'black', lastMove: [last.from, last.to] }
}

export function mateMoves(fen) {
  const chess = new Chess(fen)
  const mates = []
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move)
    if (chess.isCheckmate()) mates.push(move.from + move.to + (move.promotion || ''))
    chess.undo()
  }
  return mates
}

export function eligibleMateControl(puzzle) {
  return puzzle.themes.includes('mateIn2') && mateMoves(puzzleStart(puzzle).fen).length === 0
}

export function selectPuzzle(puzzles, { mode = 'mixed', target = 900, recent = [], turn = 0, random = Math.random } = {}) {
  if (!PUZZLE_MODES.includes(mode)) throw new Error('Mode d’exercice inconnu')
  const wantControl = mode === 'mate1' && turn % 5 === 4
  const matches = puzzles.filter((puzzle) => {
    if (mode === 'mate1') return wantControl ? puzzle.control === true : puzzle.themes.includes('mateIn1')
    return mode === 'mixed' || puzzle.cat === mode
  })
  if (!matches.length) return null
  const recentIds = new Set(recent)
  const fresh = matches.filter((p) => !recentIds.has(p.id))
  const pool = fresh.length ? fresh : matches
  const byRating = [...pool].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || a.id.localeCompare(b.id))
  const window = byRating.slice(0, Math.min(byRating.length, Math.max(120, Math.ceil(byRating.length / 3))))
  return window[Math.min(window.length - 1, Math.floor(random() * window.length))]
}
