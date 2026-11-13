// Synthetic, disposable progress for testing the existing board routes; never player data.
import { readFileSync } from 'node:fs'
import { linesFromTree } from '../../../src/core/lines.js'
import { recordRun, DAY } from '../../../src/core/srs.js'
import { makeEvent, exportJournal } from '../../../src/core/journal.js'
import { parsePgnGames, analyzeGame } from '../../../src/core/pgn-games.js'
import { evaluateDuel } from '../../../src/core/adventure.js'
import season from '../../../catalog/adventure-season-1.json'
const at = Date.now() - 2 * DAY, device = 'isolated-ui-fixture'
const events = [makeEvent('setting', { key: 'locale', value: 'fr' }, device, at), makeEvent('repertoire', { openingId: 'partie-italienne', present: true }, device, at)]
const bundle = JSON.parse(readFileSync(new URL('../../../catalog/trees/partie-italienne.json', import.meta.url)))
const lines = linesFromTree(bundle.tree, 'white')
for (const line of lines.slice(0, 5)) {
  const entry = recordRun({}, line.id, 0, at)[line.id]
  events.push(makeEvent('line', { openingId: 'partie-italienne', lineId: line.id, entry, runsDelta: 1, flawlessDelta: 1 }, device, at))
}
const pgn = '[Event "UI fixture"]\n[White "Alice"]\n[Black "Bob"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 Nf6 5. d4 exd4 *'
const gameId = 'ui-fixture-game'
const game = { ...parsePgnGames(pgn).games[0], gameId }
const engine = { analyse: async (_fen, options) => [{ uci: options.searchmoves?.[0] || 'd2d4', score: options.searchmoves ? -800 : 100 }] }
const analysis = await analyzeGame(game, 'white', engine)
events.push(makeEvent('game', { phase: 'imported', gameId, pgn, side: 'white', white: 'Alice', black: 'Bob', date: '2026.10.18' }, device, at))
events.push(makeEvent('game', { phase: 'analyzed', gameId, decisions: analysis.decisions, engine: 'fixture' }, device, at))
for (const encounter of season.encounters) {
  const duel = { initialFen: encounter.duel.initialFen, ...encounter.duel.witness, stage: 'player' }
  const outcome = evaluateDuel({ ...duel, goal: encounter.goal, side: encounter.side, score: duel.evaluations.at(-1) })
  const checkpoint = { phase: 'result', result: outcome.status, reason: outcome.reason, gain: outcome.gain, confirmed: true, aided: false, duel }
  events.push(makeEvent('activity', { event: { id: `ui-win-${encounter.id}`, at, day: new Date(at).toISOString().slice(0,10), kind: 'adventure', xp: 0, data: { seasonId: season.id, seasonVersion: 1, encounterId: encounter.id, encounterVersion: 1, attemptId: 'ui-fixture', step: 0, checkpoint } } }, device, at))
}
process.stdout.write(exportJournal(events))
