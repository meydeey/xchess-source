import { describe, expect, test } from 'bun:test'
import { exportJournal, importJournal, makeEvent, mergeEvents, migrationEvents, replayJournal } from '../src/core/journal.js'

const device = 'mac'
const event = (kind, data, at, id) => ({ id, kind, data, at, day: '2026-09-26', device, v: 1 })
const entry = (lastRun, runs = 2) => ({ box: 2, due: lastRun + 1000, runs, flawless: 1, lastRun, days: ['2026-09-25'], introduced: '2026-09-20', weak: [3] })

describe('journal', () => {
  test('20 ordres d’arrivée donnent le même état, reset compris', () => {
    const events = [
      event('setting', { key: 'elo', value: 500 }, 1, 'a'),
      event('repertoire', { openingId: 'italian', present: true }, 2, 'b'),
      event('line', { openingId: 'italian', lineId: 'e4', entry: entry(3) }, 3, 'c'),
      event('reset', { scope: 'progress' }, 4, 'd'),
      event('line', { openingId: 'italian', lineId: 'd4', entry: entry(5) }, 5, 'e'),
    ]
    const expected = replayJournal(events)
    for (let shift = 0; shift < 20; shift++) {
      const shuffled = [...events].sort((a, b) => ((a.id.charCodeAt(0) * (shift + 7)) % 11) - ((b.id.charCodeAt(0) * (shift + 7)) % 11))
      expect(replayJournal(shuffled)).toEqual(expected)
    }
    expect(expected.progress.italian.e4).toBeUndefined()
    expect(expected.progress.italian.d4.runs).toBe(2)
  })

  test('migration idempotente, données complètes et 2 instantanés sans somme', () => {
    const snapshot = { progress: { italian: { e4: entry(100) } }, repertoire: ['italian'], settings: { elo: 400 } }
    const a = migrationEvents(snapshot, 'mac')
    expect(mergeEvents(a, migrationEvents(snapshot, 'mac'))).toEqual(a)
    const b = migrationEvents({ progress: { italian: { e4: entry(200, 3) } } }, 'iphone')
    const merged = replayJournal([...a, ...b])
    expect(merged.progress.italian.e4).toEqual(entry(200, 3))
    expect(merged.repertoire).toEqual(['italian'])
    expect(merged.settings.elo).toBe(400)
  })

  test('les essais de puzzles antérieurs rejoignent le journal une seule fois', () => {
    const puzzleAttempts = [{ ref: 'p-1', mode: 'mixed', result: 'failed', errors: 1, rating: 900, cat: 'tactics', at: 1234 }]
    const first = migrationEvents({ puzzleAttempts }, 'mac')
    expect(first).toHaveLength(1)
    expect(first[0].kind).toBe('puzzle')
    expect(first[0].data.ref).toBe('p-1')
    expect(mergeEvents(first, migrationEvents({ puzzleAttempts }, 'mac'))).toEqual(first)
  })

  test('2 passages hors ligne sur la même ligne gardent les 2 tentatives après fusion', () => {
    const baseline = migrationEvents({ progress: { italian: { e4: entry(100, 2) } } }, 'mac')
    const next = entry(300, 3)
    const first = event('line', { openingId: 'italian', lineId: 'e4', entry: next, runsDelta: 1, flawlessDelta: 1 }, 300, 'mac-run')
    const second = { ...event('line', { openingId: 'italian', lineId: 'e4', entry: entry(400, 3), runsDelta: 1, flawlessDelta: 1 }, 400, 'iphone-run'), device: 'iphone' }
    const merged = replayJournal([...baseline, second, first])
    expect(merged.progress.italian.e4.runs).toBe(4)
    expect(merged.progress.italian.e4.flawless).toBe(3)
    expect(merged.progress.italian.e4.lastRun).toBe(400)
  })

  test('export, import, doublon divergent et fichier corrompu', () => {
    const a = makeEvent('setting', { key: 'elo', value: 400 }, 'mac', Date.now())
    expect(importJournal(exportJournal([a]))).toEqual([a])
    expect(importJournal(exportJournal([a]), [a])).toEqual([a])
    expect(() => importJournal(exportJournal([{ ...a, data: { key: 'elo', value: 600 } }]), [a])).toThrow('divergent')
    expect(() => importJournal('{')).toThrow('illisible')
    expect(() => importJournal('{"format":"chessorbit-journal","version":2,"events":[]}')).toThrow('inconnu')
  })
})
