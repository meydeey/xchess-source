import { describe, expect, test } from 'bun:test'
import { analyzeGame, gameFingerprint, parsePgnGames, pgnPlayers, sideForPlayer, winningChance } from '../src/core/pgn-games.js'

const one = `[Event "Training"]\n[Site "Chess.com"]\n[Date "2026.09.26"]\n[White "Alice"]\n[Black "Bob"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 *`

describe('PGN import and game decisions', () => {
  test('parses multiple games and assigns the chosen player', async () => {
    const { games, invalid } = parsePgnGames(`${one}\n\n${one.replace('Alice', 'Carol')}`)
    expect(games).toHaveLength(2)
    expect(invalid).toHaveLength(0)
    expect(pgnPlayers(games)[0]).toEqual({ name: 'Bob', count: 2 })
    expect(sideForPlayer(games[0], 'alice')).toBe('white')
    expect(sideForPlayer(games[1], 'Alice')).toBe(null)
    expect(await gameFingerprint(games[0])).not.toBe(await gameFingerprint(games[1]))
    expect(await gameFingerprint(games[0])).not.toBe(await gameFingerprint({ ...games[0], time: '12:00:00' }))
  })

  test('reports malformed games without discarding valid ones', () => {
    const { games, invalid } = parsePgnGames(`${one}\n\n[Event "Broken"]\n\n1. e4 nonsense`)
    expect(games).toHaveLength(1)
    expect(invalid).toEqual([2])
  })

  test('win chance follows side and a game produces a replayable decision', async () => {
    expect(winningChance(500, 'white')).toBeGreaterThan(0.8)
    expect(winningChance(500, 'black')).toBeLessThan(0.2)
    const game = { ...parsePgnGames(one).games[0], gameId: 'one' }
    const engine = { analyse: async (_fen, opts) => opts.searchmoves
      ? [{ uci: opts.searchmoves[0], score: -800 }]
      : [{ uci: 'c4d5', score: 100 }] }
    const result = await analyzeGame(game, 'white', engine)
    expect(result.complete).toBe(true)
    expect(result.decisions[0].gameId).toBe('one')
    expect(result.decisions[0].mistake).toBe(true)
  })

  test('keeps a strong decision when no serious mistake occurred and resumes from a checkpoint', async () => {
    const game = { ...parsePgnGames(one).games[0], gameId: 'one' }
    const engine = { analyse: async (_fen, opts) => [{ uci: opts.searchmoves?.[0] || 'd2d4', score: 20 }] }
    const paused = await analyzeGame(game, 'white', engine, { shouldPause: () => true })
    expect(paused.complete).toBe(false)
    expect(paused.nextPly).toBe(0)
    const complete = await analyzeGame(game, 'white', engine, { fromPly: paused.nextPly, previous: paused.decisions })
    expect(complete.complete).toBe(true)
    expect(complete.decisions[0].mistake).toBe(false)
  })
})
