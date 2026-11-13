import { test, expect } from 'bun:test'
import { createAdventureWriter } from '../src/platform/adventure-journal.js'
import { mergeEvents, replayJournal, exportJournal, importJournal } from '../src/core/journal.js'
import { deriveAdventure } from '../src/core/adventure.js'
import season from '../catalog/adventure-season-1.json'

const checkpoint = { phase: 'preparation', puzzleIds: ['a', 'b', 'c'], preparationIndex: 1, aided: false }
const fact = () => ({ seasonId: season.id, seasonVersion: 1, encounterId: 'club-loose', encounterVersion: 1, attemptId: 'test-attempt', step: 2, checkpoint, puzzleAttempt: { ref: 'a', mode: 'adventure', cat: 'tactics', result: 'solved', errors: 0, aided: false, rating: 800 } })
function fixture() {
  let events = []
  let failing = false
  const writes = []
  const writer = createAdventureWriter({
    device: 'test-device', getEvents: () => events,
    journal: { async appendMany(batch) { if (failing) throw new Error('disk unavailable'); writes.push(batch); events = mergeEvents(events, batch); return true } },
    onCommitted() {},
  })
  return { writer, writes, events: () => events, fail(value) { failing = value } }
}

test('a preparation checkpoint, puzzle stats and existing puzzle XP commit atomically once', async () => {
  const f = fixture()
  expect(await f.writer.save(fact())).toBe(true)
  expect(f.writes).toHaveLength(1)
  expect(f.writes[0]).toHaveLength(3)
  expect(f.events().filter((event) => event.kind === 'puzzle')).toHaveLength(1)
  const activity = replayJournal(f.events()).activity
  expect(activity.find((event) => event.kind === 'adventure').xp).toBe(0)
  expect(activity.find((event) => event.kind === 'puzzle').xp).toBe(10)
  expect(await f.writer.save(fact())).toBe(true)
  expect(f.writes).toHaveLength(1)
  const imported = importJournal(exportJournal(f.events()), f.events())
  expect(imported).toHaveLength(3)
  expect(deriveAdventure(imported, season).encounters['club-loose'].attempts['test-attempt'].step).toBe(2)
})
test('a failed transaction advances nothing, then retries the same fact without duplicate XP', async () => {
  const f = fixture()
  f.fail(true)
  expect(await f.writer.save(fact())).toBe(false)
  expect(f.events()).toEqual([])
  f.fail(false)
  expect(await f.writer.save(fact())).toBe(true)
  expect(f.events()).toHaveLength(3)
  expect(await f.writer.save(fact())).toBe(true)
  expect(f.events()).toHaveLength(3)
})
test('double clicks serialize, and a divergent step cannot overwrite an acquired result', async () => {
  const f = fixture()
  expect(await Promise.all([f.writer.save(fact()), f.writer.save(fact())])).toEqual([true, true])
  expect(f.writes).toHaveLength(1)
  expect(await f.writer.save({ ...fact(), checkpoint: { ...checkpoint, aided: true } })).toBe(false)
  expect(f.events()).toHaveLength(3)
  expect(await f.writer.save(fact())).toBe(true)
})
test('checkpoint snapshots cannot mutate while a save waits for storage', async () => {
  let resolveWrite
  let saved
  const writer = createAdventureWriter({ device: 'test', getEvents: () => [], journal: { async appendMany(batch) { saved = batch; await new Promise((resolve) => { resolveWrite = resolve }); return true } } })
  const mutable = fact()
  mutable.checkpoint = structuredClone(checkpoint)
  const saving = writer.save(mutable)
  mutable.checkpoint.preparationIndex = 99
  await Promise.resolve()
  resolveWrite()
  expect(await saving).toBe(true)
  expect(saved[0].data.event.data.checkpoint.preparationIndex).toBe(1)
})

test('a route resumed after a failed save may recompute an uncommitted confirmation', async () => {
  const f = fixture()
  f.fail(true)
  expect(await f.writer.save(fact())).toBe(false)
  f.fail(false)
  const recomputed = { ...fact(), checkpoint: { ...checkpoint, analysis: 120 } }
  expect(await f.writer.save(recomputed)).toBe(true)
  expect(f.events()).toHaveLength(3)
})
