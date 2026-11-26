import { expect, test } from 'bun:test'
import { boardThemesFor, equippedBoardTheme } from '../src/core/board-themes.js'
import { deriveGame } from '../src/core/game.js'
import { exportJournal, importJournal, makeEvent, migrationEvents, replayJournal } from '../src/core/journal.js'

const device = 'fixture-device'
const result = (encounterId, { at = 30, result = 'won', confirmed = true, ...data } = {}) => ({
  id: `${encounterId}:${at}`, kind: 'adventure', at, day: '2026-11-24', xp: 0,
  data: {
    seasonId: 'white-rabbit-1', seasonVersion: 1, encounterId, encounterVersion: 1, attemptId: 'attempt', step: 1,
    checkpoint: { phase: 'result', result, confirmed, aided: true },
    ...data,
  },
})
const chapters = [
  ['club-loose', 'club-mate', 'club-final'],
  ['tournament-pin', 'tournament-skewer', 'tournament-final'],
  ['beyond-discovery', 'beyond-promotion', 'beyond-final'],
]
const activity = (event) => makeEvent('activity', { event }, device, event.at)

test('journal v1 restores all earned boards and re-equips the saved theme', () => {
  const themes = ['current', 'club', 'burrow', 'code', 'passage']
  for (let completed = 0; completed <= chapters.length; completed++) {
    const historical = chapters.slice(0, completed).flat().map((id) => activity(result(id)))
    const boardTheme = themes[completed + 1]
    const setting = makeEvent('setting', { key: 'boardTheme', value: boardTheme }, device)
    const backup = exportJournal([setting, ...historical].reverse())
    const resumed = importJournal(backup, importJournal(backup))
    expect(boardThemesFor(resumed)).toEqual(themes.slice(0, completed + 2))
    expect(equippedBoardTheme(replayJournal(resumed).settings, boardThemesFor(resumed))).toBe(boardTheme)
  }
})

test('unexpected versions, incomplete chapters and superseded results do not grant boards', () => {
  const base = [activity(result('club-loose')), activity(result('club-mate'))]
  for (const overrides of [
    { seasonId: 'other' }, { seasonVersion: 2 }, { encounterVersion: 2 },
    { step: -1 }, { attemptId: '' }, { confirmed: false }, { result: 'lost' },
    { checkpoint: { phase: 'duel' } },
  ]) {
    const available = boardThemesFor([...base, activity(result('club-final', overrides))])
    expect(available).toEqual(['current', 'club'])
    expect(equippedBoardTheme({ boardTheme: 'burrow' }, available)).toBe('current')
  }
  const win = result('club-final')
  const correction = result('club-final', { at: 40, result: 'lost' })
  expect(boardThemesFor([activity(correction), ...base, activity(win)])).toEqual(['current', 'club'])
  // A different attempt or a later step does not erase a past victory.
  expect(boardThemesFor([...base, activity(win), activity(result('club-final', { at: 50, step: 2, result: 'lost' }))])).toContain('burrow')
  expect(equippedBoardTheme({ boardTheme: 'unknown' }, boardThemesFor())).toBe('current')
})

test('round trips preserve retired checkpoints and settings, puzzle attempts, XP and learning progress', () => {
  const victories = chapters[0].map((id) => result(id))
  const checkpoint = result('tournament-pin', { checkpoint: { phase: 'preparation', preparationIndex: 1, puzzleIds: ['a', 'b', 'c'] } })
  const puzzle = { ref: 'p1', mode: 'adventure', cat: 'tactics', result: 'solved', errors: 0, aided: false }
  const puzzleXp = { id: 'p1-xp', at: 100, day: '2026-11-24', kind: 'puzzle', xp: 10, data: puzzle }
  const entry = { box: 3, runs: 8, flawless: 4 }
  const history = migrationEvents({
    settings: { boardTheme: 'burrow', rabbitOutfit: 'explorer', companionVisible: false },
    repertoire: ['london'],
    progress: { london: { 'line-1': entry } },
    activity: [...victories, checkpoint, puzzleXp],
    puzzleAttempts: [{ ...puzzle, at: puzzleXp.at }],
  }, device)
  const restored = importJournal(exportJournal(history))
  expect(restored).toEqual(history)
  expect(restored.filter((event) => event.kind === 'puzzle').map((event) => event.data)).toEqual([puzzle])
  const state = replayJournal(restored)
  expect(state.settings).toEqual({ boardTheme: 'burrow', rabbitOutfit: 'explorer', companionVisible: false })
  expect(state.repertoire).toEqual(['london'])
  expect(state.progress).toEqual({ london: { 'line-1': entry } })
  expect(state.activity).toContainEqual(checkpoint)
  const game = deriveGame(state.activity, { now: puzzleXp.at })
  expect(game.xp).toBe(10)
  expect(game.counters.puzzlesSolved).toBe(1)
  expect(equippedBoardTheme(state.settings, boardThemesFor(restored))).toBe('burrow')
})
