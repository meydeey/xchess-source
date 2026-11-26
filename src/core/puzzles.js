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

function hasRecordedMateInOne(puzzle) {
  try {
    const chess = new Chess(puzzle.fen)
    return Boolean(playUci(chess, puzzle.moves?.[0]) && playUci(chess, puzzle.moves?.[1]) && chess.isCheckmate())
  } catch { return false }
}

export function selectPuzzle(puzzles, { mode = 'mixed', target = 900, recent = [], random = Math.random } = {}) {
  if (!PUZZLE_MODES.includes(mode)) throw new Error('Mode d’exercice inconnu')
  const matches = puzzles.filter((puzzle) => {
    if (mode === 'mate1') return !puzzle.control && puzzle.themes.includes('mateIn1')
    return mode === 'mixed' || puzzle.cat === mode
  })
  if (!matches.length) return null
  const recentIds = new Set(recent)

  function pick(pool) {
    if (!pool.length) return null
    pool.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || a.id.localeCompare(b.id))
    const size = Math.min(pool.length, Math.max(120, Math.ceil(pool.length / 3)))
    const index = Math.min(size - 1, Math.floor(random() * size))
    if (mode !== 'mate1') return pool[index]

    // Validate the chosen position, only scanning farther if the recorded move fails to mate.
    const ordered = [...pool.slice(index, size), ...pool.slice(0, index), ...pool.slice(size)]
    return ordered.find(hasRecordedMateInOne) ?? null
  }

  return pick(matches.filter((p) => !recentIds.has(p.id))) ?? pick(matches.filter((p) => recentIds.has(p.id)))
}
