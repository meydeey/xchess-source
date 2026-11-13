import { test, expect } from 'bun:test'
import { Chess } from 'chess.js'
import season from '../catalog/adventure-season-1.json'
import { restoreDuel, evaluateDuel } from '../src/core/adventure.js'

test('season 1 contains 3 chapters, 9 legal encounters and alternating duel camps', () => {
  expect(season.chapters).toHaveLength(3)
  expect(season.encounters).toHaveLength(9)
  expect(new Set(season.encounters.map((item) => item.id)).size).toBe(9)
  season.encounters.forEach((encounter, index) => {
    expect(encounter.side).toBe(index % 2 ? 'black' : 'white')
    expect(new Chess(encounter.duel.initialFen).turn()).toBe(encounter.side === 'white' ? 'w' : 'b')
    const final = restoreDuel({ ...encounter.duel, ...encounter.duel.witness })
    expect(final.history().length).toBeLessThanOrEqual(12)
    for (const locale of ['fr', 'en', 'es']) {
      expect(encounter.title[locale].length).toBeGreaterThan(3)
      expect(encounter.opponent.invitation[locale].length).toBeGreaterThan(10)
    }
    expect(evaluateDuel({ ...encounter.duel, ...encounter.duel.witness, side: encounter.side, goal: encounter.goal, score: encounter.duel.witness.evaluations.at(-1) }).status).toBe('won')
    if (encounter.opening) {
      const chess = new Chess()
      for (const move of encounter.opening.continuation) chess.move(move)
      expect(chess.fen()).toBe(encounter.duel.initialFen)
      expect(encounter.opening.continuation.slice(0, encounter.opening.preparation.length)).toEqual(encounter.opening.preparation)
    }
  })
})
