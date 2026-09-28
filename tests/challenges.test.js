import { describe, expect, test } from 'bun:test'
import { deriveChallengePath } from '../src/core/challenges.js'

const puzzle = (ref, rating, cat, at, won = true, aided = false) => ({ ref, rating, cat, at, result: won ? 'solved' : 'failed', errors: won ? 0 : 1, aided })

describe('challenge path', () => {
  test('a beginner needs distinct first attempts and delayed recalls', () => {
    const attempts = Array.from({ length: 12 }, (_, i) => puzzle(`p${i}`, 700, i % 2 ? 'attack' : 'defense', i, i < 8))
    const activity = [0, 1].map((i) => ({ kind: 'line', data: { o: 'one', l: String(i), ph: 'due', err: 0 } }))
    const path = deriveChallengePath({ attempts, activity })
    expect(path.stages[0].complete).toBe(true)
    expect(path.focus.id).toBe('intermediate')
    expect(path.next.href).toBe('#/exercises/mixed/intermediate')
    expect(deriveChallengePath({ attempts: [...attempts, puzzle('p0', 700, 'attack', 50)], activity }).stages[0].puzzle.attempted).toBe(12)
    expect(deriveChallengePath({ attempts, activity: activity.slice(0, 1) }).stages[0].complete).toBe(false)
  })

  test('a passed window remains acquired when later mistakes lower the focus', () => {
    const successes = Array.from({ length: 12 }, (_, i) => puzzle(`a${i}`, 700, i % 2 ? 'attack' : 'tactics', i, true))
    const failures = Array.from({ length: 12 }, (_, i) => puzzle(`b${i}`, 700, i % 2 ? 'attack' : 'tactics', 20 + i, false))
    const activity = [0, 1].map((i) => ({ kind: 'line', data: { o: 'one', l: String(i), ph: 'due', err: 0 } }))
    const stage = deriveChallengePath({ attempts: [...successes, ...failures], activity }).stages[0]
    expect(stage.puzzle.passed).toBe(true)
    expect(stage.puzzle.wins).toBe(0)
    expect(stage.complete).toBe(true)
  })

  test('an aided first attempt cannot be farmed later', () => {
    const attempts = [puzzle('a', 700, 'attack', 1, true, true), puzzle('a', 700, 'attack', 2)]
    expect(deriveChallengePath({ attempts }).stages[0].puzzle.attempted).toBe(0)
  })

  test('personal decisions require an imported game and a delayed clean replay', () => {
    const gameId = 'game-1'
    const journal = [
      { kind: 'game', at: 1, data: { phase: 'imported', gameId } },
      { kind: 'drill', at: 2, data: { ref: 'game-1:12', gameId, result: 'seen' } },
      { kind: 'drill', at: 86400002, data: { ref: 'game-1:12', gameId, result: 'solved', errors: 0, originAt: 1 } },
      { kind: 'drill', at: 86400003, data: { ref: 'game-1:12', gameId, result: 'solved', errors: 0, originAt: 1 } },
      { kind: 'drill', at: 86400004, data: { ref: 'missing:1', gameId: 'missing', result: 'solved', errors: 0, originAt: 1 } },
    ]
    expect(deriveChallengePath({ journal }).stages[1].replayed).toBe(1)
    expect(deriveChallengePath({ journal: journal.slice(1) }).stages[1].replayed).toBe(0)
    expect(deriveChallengePath({ journal: [journal[0], journal[2]] }).stages[1].replayed).toBe(0)
  })

  test('expert proof validates earlier stages without forcing easy puzzles', () => {
    const cats = ['attack', 'tactics', 'defense', 'technique']
    const attempts = Array.from({ length: 40 }, (_, i) => puzzle(`expert-${i}`, 2400, cats[i % 4], i, i < 32))
    const activity = Array.from({ length: 10 }, (_, i) => ({ kind: 'line', data: { o: 'opening', l: String(i), ph: 'due', err: 0 } }))
    const imports = [0, 1, 2].map((i) => ({ kind: 'game', at: 1, data: { phase: 'imported', gameId: `g${i}` } }))
    const seen = Array.from({ length: 5 }, (_, i) => ({ kind: 'drill', at: 2 + i, data: { ref: `g${i % 3}:${i}`, gameId: `g${i % 3}`, result: 'seen' } }))
    const drills = Array.from({ length: 5 }, (_, i) => ({ kind: 'drill', at: 86400007 + i, data: { ref: `g${i % 3}:${i}`, gameId: `g${i % 3}`, result: 'solved', errors: 0, originAt: 1 } }))
    const path = deriveChallengePath({ attempts, activity, journal: [...imports, ...seen, ...drills] })
    expect(path.stages[4].complete).toBe(true)
    expect(path.stages.slice(0, 4).every((stage) => stage.inherited && stage.complete)).toBe(true)
    expect(path.focus.id).toBe('expert')
  })
})
