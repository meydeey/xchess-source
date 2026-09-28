// Parcours de compétence : preuves rejouables depuis les journaux existants.
// La difficulté d'un puzzle Lichess n'est jamais assimilée à l'Elo du joueur.
import { eloToBand } from './metrics.js'
import { derivePuzzleTraining } from './puzzle-training.js'

export const CHALLENGE_STAGES = [
  { id: 'foundations', min: 400, max: 899, count: 12, wins: 8, categories: 2, lines: 2, games: 0 },
  { id: 'intermediate', min: 900, max: 1299, count: 20, wins: 14, categories: 3, lines: 4, games: 1 },
  { id: 'club', min: 1300, max: 1699, count: 24, wins: 18, categories: 4, lines: 6, games: 2 },
  { id: 'advanced', min: 1700, max: 2199, count: 30, wins: 23, categories: 4, lines: 8, games: 3 },
  { id: 'expert', min: 2200, max: 2799, count: 40, wins: 32, categories: 4, lines: 10, games: 5, distinctGames: 3 },
]

const BAND_INDEX = { debutant: 0, intermediaire: 1, club: 2, avance: 3, expert: 4 }
const validPuzzle = (a) => a?.ref && Number.isFinite(a.rating) && ['attack', 'tactics', 'defense', 'technique'].includes(a.cat)
const clean = (a) => a.result === 'solved' && !a.errors && !a.aided
const ordered = (rows) => [...rows].sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id || '').localeCompare(String(b.id || '')))

function puzzleEvidence(attempts, stage) {
  const eligible = attempts.filter((a) => a.rating >= stage.min && a.rating <= stage.max && !a.aided)
  let passed = false
  for (let end = stage.count; end <= eligible.length; end++) {
    const window = eligible.slice(end - stage.count, end)
    if (window.filter(clean).length >= stage.wins && new Set(window.map((a) => a.cat)).size >= stage.categories) {
      passed = true
      break
    }
  }
  const current = eligible.slice(-stage.count)
  return { attempted: current.length, wins: current.filter(clean).length, categories: new Set(current.map((a) => a.cat)).size, passed }
}

export function deriveChallengePath({ elo = 400, source = 'chesscom', attempts = [], activity = [], journal = [], now = Date.now() } = {}) {
  const first = []
  const seen = new Set()
  for (const a of ordered(attempts)) {
    if (!validPuzzle(a) || seen.has(a.ref)) continue
    seen.add(a.ref)
    first.push(a)
  }
  const recalled = new Set(activity.filter((e) => e.kind === 'line' && e.data?.ph === 'due' && e.data?.err === 0 && e.data?.aided !== true)
    .map((e) => `${e.data.o}:${e.data.l}`))
  const replayed = new Map()
  const firstSeen = new Map()
  const imports = new Map(journal.filter((e) => e.kind === 'game' && e.data?.phase === 'imported').map((e) => [e.data.gameId, e.at]))
  const importedGames = new Set(imports.keys())
  const decisions = journal.filter((e) => e.kind === 'game' && e.data?.phase === 'analyzed' && importedGames.has(e.data.gameId)).flatMap((e) => e.data.decisions || [])
  for (const e of ordered(journal.filter((entry) => entry.kind === 'drill'))) {
    const d = e.data || {}
    if (!d.ref || !d.gameId || !importedGames.has(d.gameId)) continue
    if (!firstSeen.has(d.ref)) firstSeen.set(d.ref, e.at)
    if (d.result !== 'solved' || d.errors || d.aided || e.at - firstSeen.get(d.ref) < 86400000) continue
    replayed.set(d.ref, d.gameId)
  }
  const directStages = CHALLENGE_STAGES.map((stage) => {
    const puzzle = puzzleEvidence(first, stage)
    const lines = recalled.size
    const games = replayed.size
    const distinctGames = new Set(replayed.values()).size
    const complete = puzzle.passed && lines >= stage.lines && games >= stage.games && distinctGames >= (stage.distinctGames || 0)
    return { ...stage, puzzle, recalled: lines, replayed: games, distinctGames, complete }
  })
  const highestDirect = directStages.reduce((highest, stage, index) => stage.complete ? index : highest, -1)
  const stages = directStages.map((stage, index) => ({ ...stage, inherited: !stage.complete && index < highestDirect, complete: stage.complete || index < highestDirect }))
  const training = derivePuzzleTraining(first)
  const calibrated = Object.values(training).filter((item) => item.count >= 10)
  const declaredIndex = BAND_INDEX[eloToBand(elo, source)] ?? 0
  const estimated = calibrated.length >= 2 ? calibrated.reduce((sum, item) => sum + item.rating, 0) / calibrated.length : null
  const estimatedIndex = estimated == null ? declaredIndex : CHALLENGE_STAGES.findIndex((stage) => estimated <= stage.max)
  const highestCompleted = stages.reduce((highest, stage, index) => stage.complete ? index : highest, -1)
  const focusIndex = Math.min(4, Math.max(0, estimatedIndex < 0 ? 4 : estimatedIndex, highestCompleted + 1))
  const focus = stages[focusIndex]
  let next = { kind: 'puzzle', href: `#/exercises/mixed/${focus.id}` }
  if (focus.puzzle.passed) next = focus.recalled < focus.lines ? { kind: 'memory', href: '#/session/go' } :
    focus.replayed < focus.games ? { kind: 'game', href: '#/games' } : { kind: 'puzzle', href: `#/exercises/mixed/${focus.id}` }
  const personalDue = decisions.filter((d) => d.ref && !replayed.has(d.ref) && now - firstSeen.get(d.ref) >= 86400000).length
  return { stages, focus, focusIndex, provisional: estimated == null, next, importedGames: importedGames.size, personalDue, training }
}
