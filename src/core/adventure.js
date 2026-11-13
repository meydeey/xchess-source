import { Chess } from 'chess.js'
import { playUci, puzzleStart } from './puzzles.js'

export function deriveAdventure(events, season) {
  const encounters = Object.fromEntries(season.encounters.map((encounter) => [encounter.id, { won: false, unaided: false, failures: 0, attempts: {} }]))
  const facts = new Map()
  for (const outer of events) {
    const event = outer.kind === 'activity' ? outer.data?.event : outer
    const fact = event?.data
    const encounter = season.encounters.find((item) => item.id === fact?.encounterId)
    if (event?.kind !== 'adventure' || !encounter || fact.seasonId !== season.id || fact.seasonVersion !== season.version || fact.encounterVersion !== encounter.version) continue
    if (typeof fact.attemptId !== 'string' || !fact.attemptId || !Number.isSafeInteger(fact.step) || fact.step < 0 || !fact.checkpoint || typeof fact.checkpoint !== 'object') continue
    const key = JSON.stringify([fact.encounterId, fact.attemptId, fact.step])
    const prior = facts.get(key)
    if (!prior || (event.at || 0) > (prior.at || 0) || event.at === prior.at && String(event.id) > String(prior.id)) facts.set(key, event)
  }
  for (const event of [...facts.values()].sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id)))) {
    const fact = event.data
    const record = encounters[fact.encounterId]
    const attempts = record.attempts
    // fromEntries prevents imported attempt IDs from addressing Object.prototype.
    if (!Object.hasOwn(attempts, fact.attemptId)) Object.defineProperty(attempts, fact.attemptId, { value: { step: -1, at: 0, won: false, failed: false }, enumerable: true })
    const attempt = attempts[fact.attemptId]
    const checkpoint = fact.checkpoint
    if (fact.step > attempt.step) Object.assign(attempt, { step: fact.step, checkpoint, at: event.at || 0 })
    if (checkpoint.phase === 'result' && checkpoint.confirmed === true) {
      if (checkpoint.result === 'won') { attempt.won = true; record.won = true; record.unaided ||= !checkpoint.aided }
      if (checkpoint.result === 'lost') attempt.failed = true
    }
  }
  const completedChapters = []
  const available = []
  let previousComplete = true
  for (const chapter of season.chapters) {
    const ids = chapter.encounters
    if (previousComplete) {
      available.push(...ids.slice(0, 2))
      if (ids.slice(0, 2).every((id) => encounters[id].won)) available.push(ids[2])
    }
    const complete = ids.every((id) => encounters[id].won)
    if (complete) completedChapters.push(chapter.id)
    previousComplete &&= complete
  }
  for (const record of Object.values(encounters)) record.failures = Object.values(record.attempts).filter((attempt) => attempt.failed).length
  return { encounters, available, completedChapters, won: season.encounters.filter((item) => encounters[item.id].won).map((item) => item.id) }
}

const puzzleStartKey = (puzzle) => puzzleStart(puzzle).fen.split(' ').slice(0, 4).join(' ')

export function selectPreparation(puzzles, { theme, target, count = 3 }) {
  const unique = [...new Map(puzzles.filter((puzzle) => puzzle.themes.includes(theme) && Math.abs(puzzle.rating - target) <= 400).map((puzzle) => [puzzle.fen ? puzzleStartKey(puzzle) : puzzle.id, puzzle])).values()]
  const sorted = unique.sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || a.id.localeCompare(b.id))
  let pool = sorted.filter((puzzle) => Math.abs(puzzle.rating - target) <= 200)
  if (pool.length < count) pool = sorted.filter((puzzle) => Math.abs(puzzle.rating - target) <= 400)
  if (pool.length < count) throw new Error('adventure.preparationUnavailable')
  return pool.slice(0, count)
}

export function restoreDuel({ initialFen, moves = [] }) {
  const chess = new Chess(initialFen)
  for (const uci of moves) if (!playUci(chess, uci)) throw new Error('adventure.invalidHistory')
  return chess
}

const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
function material(chess, color) {
  return chess.board().flat().filter(Boolean).reduce((sum, piece) => sum + VALUES[piece.type] * (piece.color === color ? 1 : -1), 0)
}

// score and evaluations always use White's viewpoint. The caller supplies only the independent
// depth-12/500-ms analysis, never the weakened opponent search. Missing confirmation suspends.
export function evaluateDuel({ initialFen, moves = [], side, goal, score = null, evaluations = [] }) {
  const chess = restoreDuel({ initialFen, moves })
  const color = side === 'white' ? 'w' : 'b'
  const sign = color === 'w' ? 1 : -1
  const history = chess.history({ verbose: true })
  const ownMoves = history.filter((move) => move.color === color)
  const rounds = ownMoves.length
  const outcome = (status, reason) => ({ status, reason, rounds, gain: material(chess, color) - material(new Chess(initialFen), color) })
  if (chess.isCheckmate()) return outcome(chess.turn() !== color ? 'won' : 'lost', 'mate')
  if (chess.isDraw()) return outcome(goal === 'defense' ? 'won' : 'lost', 'draw')
  if (!rounds || chess.turn() !== color) return outcome('playing', null)
  if (goal === 'mate') return outcome(rounds >= 6 ? 'lost' : 'playing', rounds >= 6 ? 'limit' : null)
  if (!Number.isFinite(score)) return outcome('verify', null)
  const favorable = score * sign
  if (goal === 'material' && material(chess, color) - material(new Chess(initialFen), color) >= 3 && favorable >= 100) return outcome('won', 'material')
  if (goal === 'defense' && rounds >= 4) return outcome(favorable >= 0 ? 'won' : 'lost', 'defense')
  if (goal === 'promotion') {
    const promoted = ownMoves.at(-1)
    const piece = promoted && chess.get(promoted.to)
    if (promoted?.promotion && piece?.color === color && piece.type === promoted.promotion && favorable >= 100) return outcome('won', 'promotion')
  }
  if (goal === 'advantage') {
    if (favorable < 150 || evaluations.some((value) => !Number.isFinite(value) || value * sign < 150)) return outcome('lost', 'advantage')
    if (rounds >= 6 && evaluations.length >= rounds) return outcome('won', 'advantage')
  }
  return outcome(rounds >= 6 ? 'lost' : 'playing', rounds >= 6 ? 'limit' : null)
}

// Backup files are local input. Validate before their checkpoint values reach the DOM or engine.
export function validateCheckpoint(checkpoint, encounter) {
  const invalid = () => { throw new Error('adventure.invalidHistory') }
  if (!checkpoint || !['invitation', 'preparation', 'duel', 'result'].includes(checkpoint.phase)) invalid()
  if (checkpoint.phase === 'invitation') return true
  if (checkpoint.phase === 'preparation') {
    const index = checkpoint.preparationIndex
    if (!Number.isInteger(index) || index < 0 || index > 2) invalid()
    const count = encounter.opening ? 2 : 3
    if (!Array.isArray(checkpoint.puzzles) || checkpoint.puzzles.length !== count || new Set(checkpoint.puzzles.map((item) => item?.id)).size !== count) invalid()
    for (const item of checkpoint.puzzles) {
      if (typeof item?.id !== 'string' || !Array.isArray(item.moves) || item.moves.length < 2) invalid()
      restoreDuel({ initialFen: item.fen, moves: item.moves })
    }
    const opening = !!encounter.opening && index === 0
    const puzzle = checkpoint.puzzles[index - (encounter.opening ? 1 : 0)]
    const state = checkpoint.preparationState
    const start = opening ? new Chess().fen() : puzzleStart(puzzle).fen
    if (!state || state.initialFen !== start || !Array.isArray(state.moves) || typeof state.done !== 'boolean') invalid()
    if (!Number.isInteger(state.index) || state.index !== state.moves.length + (opening ? 0 : 1)) invalid()
    if (state.index > (opening ? encounter.opening.preparation.length : puzzle.moves.length)) invalid()
    if (!Number.isInteger(state.errors) || state.errors < 0 || state.errors > 3 || !Number.isInteger(state.hints) || state.hints < 0 || !Number.isFinite(state.startedAt)) invalid()
    restoreDuel(state)
    return true
  }
  const duel = checkpoint.duel
  if (!duel || duel.initialFen !== encounter.duel.initialFen || !Array.isArray(duel.moves) || duel.moves.length > 12 || !Array.isArray(duel.evaluations) || !duel.evaluations.every(Number.isFinite)) invalid()
  const chess = restoreDuel(duel)
  const color = encounter.side === 'white' ? 'w' : 'b'
  if (checkpoint.phase === 'duel') {
    if (!['player', 'engine', 'verify'].includes(duel.stage)) invalid()
    if (duel.stage === 'engine' ? chess.turn() === color : chess.turn() !== color) invalid()
    return true
  }
  if (!checkpoint.confirmed || !['won', 'lost'].includes(checkpoint.result) || !Number.isFinite(checkpoint.gain)) invalid()
  const outcome = evaluateDuel({ ...duel, side: encounter.side, goal: encounter.goal, score: duel.evaluations.at(-1) })
  if (checkpoint.result !== outcome.status || checkpoint.reason !== outcome.reason || checkpoint.gain !== outcome.gain) invalid()
  return true
}
