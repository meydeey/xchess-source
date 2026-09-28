import { describe, expect, test } from 'bun:test'
import { derivePuzzleTraining, glickoPuzzleResult, trainingTarget, chooseTrainingPuzzle, needsPuzzleGuidance } from '../src/core/puzzle-training.js'

const event = (ref, cat, rating, result, errors = 0, at = 0, aided = false) => ({ ref, cat, rating, result, errors, at, aided })
const puzzle = (id, cat, rating) => ({ id, cat, rating, themes: ['fork'] })

describe('adaptive puzzle training', () => {
  test('a first clean success raises the category rating; a first error lowers it', () => {
    const start = { rating: 1000, rd: 350, volatility: 0.06 }
    expect(glickoPuzzleResult(start, 1000, true).rating).toBeGreaterThan(1000)
    expect(glickoPuzzleResult(start, 1000, false).rating).toBeLessThan(1000)
  })

  test('helped and repeated positions never change the training rating', () => {
    const attempts = [
      event('a', 'tactics', 900, 'solved', 0, 1),
      event('a', 'tactics', 900, 'failed', 3, 2),
      event('b', 'tactics', 900, 'solved', 0, 3, true),
    ]
    const result = derivePuzzleTraining(attempts)
    expect(result.tactics.count).toBe(1)
    expect(result.tactics.rating).toBeGreaterThan(1000)
  })

  test('a wrong first move counts as failure even when the player later solves the position', () => {
    const result = derivePuzzleTraining([event('a', 'defense', 1000, 'solved', 1, 1)])
    expect(result.defense.rating).toBeLessThan(1000)
  })

  test('calibrates from declared rating, then follows the category rating', () => {
    const start = derivePuzzleTraining([])
    expect(trainingTarget(start.tactics, 400, 'chesscom')).toBe(800)
    const enough = derivePuzzleTraining(Array.from({ length: 10 }, (_, i) => event(`p${i}`, 'tactics', 900, 'solved', 0, i)))
    expect(trainingTarget(enough.tactics, 400, 'chesscom')).toBeGreaterThan(800)
  })

  test('returns a failed position after 3 other attempts in mixed practice', () => {
    const attempts = [
      event('miss', 'tactics', 800, 'failed', 3, 1),
      event('one', 'attack', 800, 'solved', 0, 2),
      event('two', 'defense', 800, 'solved', 0, 3),
      event('three', 'technique', 800, 'solved', 0, 4),
    ]
    const puzzles = [puzzle('miss', 'tactics', 800), puzzle('fresh', 'tactics', 800)]
    const choice = chooseTrainingPuzzle(puzzles, { mode: 'mixed', attempts, turn: 3, recent: [], elo: 400, source: 'chesscom', random: () => 0 })
    expect(choice?.id).toBe('miss')
  })

  test('guidance follows training skill after calibration and returns if skill falls', () => {
    expect(needsPuzzleGuidance({ count: 0 }, 400)).toBe(true)
    expect(needsPuzzleGuidance({ count: 0 }, 1600)).toBe(false)
    expect(needsPuzzleGuidance({ count: 10, rating: 1200 }, 400)).toBe(false)
    expect(needsPuzzleGuidance({ count: 11, rating: 1000 }, 1600)).toBe(true)
  })

  test('advanced players can be placed above the former 1800 ceiling', () => {
    expect(trainingTarget({ count: 0 }, 2200, 'chesscom')).toBe(2600)
    const improved = glickoPuzzleResult({ rating: 2200, rd: 200, volatility: 0.06, count: 15 }, 2500, true)
    expect(improved.rating).toBeGreaterThan(2200)
  })
})
