import { test, expect } from 'bun:test'
import { Chess } from 'chess.js'
import content from '../catalog/adventure-season-1.json'
import { deriveAdventure, selectPreparation, restoreDuel, evaluateDuel, validateCheckpoint } from '../src/core/adventure.js'

const season = { id: 's1', version: 1, chapters: [{ id: 'club', encounters: ['a', 'b', 'c'] }, { id: 'tournament', encounters: ['d', 'e', 'f'] }], encounters: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, version: 1 })) }
const event = (encounterId, attemptId, step, checkpoint, at = step) => ({ id: `${encounterId}:${attemptId}:${step}`, at, kind: 'adventure', xp: 0, data: { seasonId: 's1', seasonVersion: 1, encounterId, encounterVersion: 1, attemptId, step, checkpoint } })
const won = (id, aided = false) => event(id, 'try1', 1, { phase: 'result', result: 'won', aided, confirmed: true })

test('adventure opens 2 encounters then a finale, with permanent unique chapter rewards', () => {
  expect(deriveAdventure([], season).available).toEqual(['a', 'b'])
  expect(deriveAdventure([won('a')], season).available).toEqual(['a', 'b'])
  expect(deriveAdventure([won('b'), won('a'), won('a')], season).available).toEqual(['a', 'b', 'c'])
  const completed = deriveAdventure([won('b'), won('c', true), won('a')], season)
  expect(completed.completedChapters).toEqual(['club'])
  expect(completed.available).toEqual(['a', 'b', 'c', 'd', 'e'])
  expect(completed.encounters.c.unaided).toBe(false)
  expect(deriveAdventure([won('a', true), event('a', 'try2', 2, { phase: 'result', result: 'won', aided: false, confirmed: true })], season).encounters.a.unaided).toBe(true)
})
test('replay tolerates arrival order and repeated imports, selecting the highest saved step', () => {
  const start = event('a', 'try1', 0, { phase: 'preparation', puzzleIds: ['p1', 'p2', 'p3'] })
  const next = event('a', 'try1', 2, { phase: 'duel', initialFen: new Chess().fen(), moves: ['e2e4'] })
  const lost = event('a', 'try2', 0, { phase: 'result', result: 'lost', confirmed: true }, 20)
  const facts = [next, won('a'), lost, start]
  const state = deriveAdventure(facts, season)
  expect(deriveAdventure([...facts, ...facts].reverse(), season)).toEqual(state)
  expect(state.encounters.a.won).toBe(true)
  expect(state.encounters.a.failures).toBe(1)
  expect(state.encounters.a.attempts.try1.checkpoint).toEqual(next.data.checkpoint)
  expect(deriveAdventure([event('z', 't', 0, {}), { ...won('a'), data: { ...won('a').data, seasonVersion: 2 } }], season).won).toEqual([])
})
test('preparations are distinct, stable and stay within 200 or 400 training points', () => {
  const puzzles = [650, 750, 950, 1100, 1700].map((rating, i) => ({ id: `p${i}`, rating, themes: ['fork'] }))
  expect(selectPreparation(puzzles, { theme: 'fork', target: 800, count: 3 })).toHaveLength(3)
  expect(selectPreparation(puzzles, { theme: 'fork', target: 800, count: 4 }).map((p) => p.id)).toEqual(['p1', 'p0', 'p2', 'p3'])
  expect(() => selectPreparation(puzzles, { theme: 'promotion', target: 800, count: 3 })).toThrow()
})
test('restoring initial position and move history retains threefold repetition', () => {
  const checkpoint = { initialFen: new Chess().fen(), moves: ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'] }
  expect(restoreDuel(checkpoint).isThreefoldRepetition()).toBe(true)
  expect(() => restoreDuel({ ...checkpoint, moves: ['e2e5'] })).toThrow()
})
test('mate and defensive draws are real chess outcomes, for either camp', () => {
  const initialFen = new Chess().fen()
  const mate = { initialFen, moves: ['f2f3', 'e7e5', 'g2g4', 'd8h4'], side: 'black', goal: 'mate' }
  expect(evaluateDuel(mate)).toMatchObject({ status: 'won', reason: 'mate' })
  expect(evaluateDuel({ ...mate, side: 'white' })).toMatchObject({ status: 'lost' })
  expect(evaluateDuel({ initialFen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', moves: [], side: 'white', goal: 'defense' })).toMatchObject({ status: 'won', reason: 'draw' })
})
test('material requires the opponent reply and a strong independent confirmation', () => {
  const position = { initialFen: '4k3/pp6/8/8/3r4/8/2B5/4K2R w K - 0 1', moves: ['c2d3'], side: 'white', goal: 'material' }
  expect(evaluateDuel(position).status).toBe('playing')
  const afterReply = { ...position, initialFen: '4k3/pp6/8/8/8/3r4/2B5/4K2R w K - 0 1', moves: ['c2d3', 'e8f7'] }
  expect(evaluateDuel(afterReply).status).toBe('verify')
  expect(evaluateDuel({ ...afterReply, score: 99 }).status).toBe('playing')
  expect(evaluateDuel({ ...afterReply, score: 100 }).status).toBe('won')
  const black = { initialFen: '4k2r/2b5/3R4/8/8/8/PP6/4K3 b k - 0 1', moves: ['c7d6', 'e1f2'], side: 'black', goal: 'material', score: -100 }
  expect(evaluateDuel(black).status).toBe('won')
})
test('a promoted piece must survive the reply and preserve an advantage', () => {
  const common = { initialFen: '8/P7/1k6/8/8/8/7p/4K3 w - - 0 1', side: 'white', goal: 'promotion' }
  expect(evaluateDuel({ ...common, moves: ['a7a8q', 'b6c5'], score: 100 }).status).toBe('won')
  expect(evaluateDuel({ ...common, initialFen: '1r6/P7/1k6/8/8/8/7p/4K3 w - - 0 1', moves: ['a7a8q', 'b8a8'], score: 200 }).status).toBe('playing')
})
test('final advantage is confirmed after every round, while defense lasts 4 rounds', () => {
  const initialFen = new Chess().fen()
  const moves = ['g1f3', 'g8f6', 'b1c3', 'b8c6', 'e2e3', 'e7e6', 'f1e2', 'f8e7', 'e1g1', 'e8g8', 'd2d3', 'd7d6']
  expect(evaluateDuel({ initialFen, moves, side: 'white', goal: 'advantage', evaluations: [150, 150, 150, 150, 150, 150], score: 150 }).status).toBe('won')
  expect(evaluateDuel({ initialFen, moves, side: 'white', goal: 'advantage', evaluations: [150, 149, 150, 150, 150, 150], score: 150 }).status).toBe('lost')
  expect(evaluateDuel({ initialFen, moves: moves.slice(0, 8), side: 'white', goal: 'defense', score: 0 }).status).toBe('won')
  expect(evaluateDuel({ initialFen, moves: moves.slice(0, 8), side: 'white', goal: 'defense', score: -1 }).status).toBe('lost')
})

test('Black promotion, defensive draws and sustained advantage use the player viewpoint', () => {
  const promotion = { initialFen: '4k3/7P/8/8/8/1K6/p7/8 b - - 0 1', moves: ['a2a1q', 'b3c4'], side: 'black', goal: 'promotion' }
  expect(evaluateDuel({ ...promotion, score: -100 }).status).toBe('won')
  expect(evaluateDuel({ ...promotion, score: -99 }).status).toBe('playing')
  expect(evaluateDuel({ ...promotion, initialFen: '4k3/7P/8/8/8/1K6/p7/1R6 b - - 0 1', moves: ['a2a1q', 'b1a1'], score: -200 }).status).toBe('playing')
  expect(evaluateDuel({ initialFen: '4k3/8/8/8/8/8/8/4K3 b - - 0 1', side: 'black', goal: 'defense' })).toMatchObject({ status: 'won', reason: 'draw' })
  const initialFen = new Chess().fen().replace(' w ', ' b ')
  const moves = ['g8f6', 'g1f3', 'b8c6', 'b1c3', 'e7e6', 'e2e3', 'f8e7', 'f1e2', 'e8g8', 'e1g1', 'd7d6', 'd2d3']
  expect(evaluateDuel({ initialFen, moves, side: 'black', goal: 'advantage', evaluations: Array(6).fill(-150), score: -150 }).status).toBe('won')
  expect(evaluateDuel({ initialFen, moves, side: 'black', goal: 'advantage', evaluations: [-150, -149, -150, -150, -150, -150], score: -150 }).status).toBe('lost')
  expect(evaluateDuel({ initialFen, moves: moves.slice(0, 8), side: 'black', goal: 'defense', score: 1 }).status).toBe('lost')
})


test('imported checkpoints validate their phase, numeric values and legal encounter history', () => {
  const encounter = content.encounters[0]
  const duel = { initialFen: encounter.duel.initialFen, ...encounter.duel.witness, stage: 'player' }
  const outcome = evaluateDuel({ ...duel, side: encounter.side, goal: encounter.goal, score: duel.evaluations.at(-1) })
  const checkpoint = { phase: 'result', result: outcome.status, reason: outcome.reason, gain: outcome.gain, confirmed: true, duel }
  expect(validateCheckpoint(checkpoint, encounter)).toBe(true)
  expect(() => validateCheckpoint({ ...checkpoint, gain: '<b>unexpected markup</b>' }, encounter)).toThrow()
  expect(() => validateCheckpoint({ phase: 'preparation', preparationIndex: '<img>' }, encounter)).toThrow()
  expect(() => validateCheckpoint({ ...checkpoint, duel: { ...duel, moves: ['e2e5'] } }, encounter)).toThrow()
})
