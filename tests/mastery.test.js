import { test, expect } from 'bun:test'
import { deriveMastery } from '../src/core/mastery.js'
import { exportJournal, importJournal } from '../src/core/journal.js'

const DAY = 86400000
const base = new Date(2026, 0, 1, 12).getTime()
const puzzle = (i, at, clean = true, ref = `p${i}`) => ({ id: `e${i}`, ref, theme: 'fork', at, result: clean ? 'solved' : 'failed', errors: clean ? 0 : 1, aided: false })
const card = (puzzles, now = base + 60 * DAY) => deriveMastery({ puzzles, now }).byKey.get('theme\0fork')

test('les 5 niveaux exigent exactement les fenêtres, jours et rappels prévus', () => {
  const rows = Array.from({ length: 40 }, (_, i) => puzzle(i, base + i * DAY))
  expect(card([]).level).toBe(0)
  expect(card(rows.slice(0, 1)).level).toBe(1)
  expect(card(rows.slice(0, 4)).level).toBe(1)
  expect(card(rows.slice(0, 5)).level).toBe(2)
  expect(card(rows.slice(0, 9)).level).toBe(2)
  expect(card(rows.slice(0, 10)).level).toBe(3)
  expect(card(rows.slice(0, 20)).level).toBe(3)
  rows[20] = puzzle(20, base + 20 * DAY, true, 'p0')
  expect(card(rows.slice(0, 21)).level).toBe(4)
  rows[39] = puzzle(39, base + 39 * DAY, true, 'p0')
  expect(card(rows).level).toBe(5)
})

test('24 h et 7 j sont des durées écoulées, et la première tentative du jour décide', () => {
  const rows = Array.from({ length: 20 }, (_, i) => puzzle(i, base + i * DAY))
  rows[19] = puzzle(19, base + 19 * DAY - 1, true, 'p18')
  expect(card(rows).level).toBe(3)
  rows[19].at += 1
  expect(card(rows).level).toBe(4)
  rows.push(puzzle(21, rows[19].at + 1, false, 'p18'))
  expect(card(rows).level).toBe(4)
})

test('fautes, aide, motif ancien absent et première tentative par position et jour', () => {
  const rows = Array.from({ length: 10 }, (_, i) => puzzle(i, base + i * DAY, i < 7))
  expect(card(rows).level).toBe(3)
  rows[0].aided = true
  expect(card(rows).level).toBe(2)
  rows.push({ ...puzzle(50, rows[0].at + 1000, true, 'p0'), id: 'later' })
  expect(card(rows).level).toBe(2)
  const unknown = { ...puzzle(60, base), theme: null }
  expect(deriveMastery({ puzzles: [unknown] }).practiced).toEqual([])
})

test('niveau acquis, fenêtre récente et horloge reculée', () => {
  const rows = Array.from({ length: 10 }, (_, i) => puzzle(i, base + i * DAY))
  rows.push(...Array.from({ length: 5 }, (_, i) => puzzle(i + 10, base + (50 + i) * DAY, false)))
  expect(card(rows).level).toBe(3)
  expect(card(rows).revive).toBe(true)
  expect(card(rows, base + 20 * DAY).level).toBe(3)
  expect(card(rows, base + 20 * DAY).recent.rate).toBe(1)
})

test('borne des 30 jours, seuil de 5 et deux ouvertures avec la même clé de ligne', () => {
  const rows = Array.from({ length: 5 }, (_, i) => puzzle(i, base + (30 + i) * DAY, false))
  const now = base + 59 * DAY
  expect(card(rows, now).recent).toMatchObject({ count: 5, rate: 0 })
  expect(card(rows, now + DAY).recent).toMatchObject({ count: 4, rate: null })
  const activity = ['a', 'b'].map((o, i) => ({ id: `line-${i}`, kind: 'line', at: base, data: { o, l: 'same-hash', err: 0 } }))
  const cards = deriveMastery({ activity }).cards.filter((item) => item.kind === 'opening')
  expect(cards.map((item) => [item.id, item.attempts])).toEqual([['a', 1], ['b', 1]])
})

test('rappel de 7 jours : une milliseconde avant ne valide pas le niveau 5', () => {
  const rows = Array.from({ length: 40 }, (_, i) => puzzle(i, base + i * DAY))
  rows[39] = puzzle(39, rows[32].at + 7 * DAY - 1, true, 'p32')
  expect(card(rows).level).toBe(4)
  rows[39].at += 1
  expect(card(rows).level).toBe(5)
})

test('ouverture retirée et import répété conservent une seule carte et la plaquette', () => {
  const event = { v: 1, id: 'activity:l1', at: base, day: '2026-01-01', device: 'd', kind: 'activity', data: { event: { id: 'l1', at: base, day: '2026-01-01', kind: 'line', data: { o: 'italian', l: 'x', err: 0 } } } }
  const twice = importJournal(exportJournal([event]), [event])
  const activity = twice.map((e) => e.data.event)
  const result = deriveMastery({ activity, now: base })
  expect(result.byKey.get('opening\0italian')).toMatchObject({ level: 1, attempts: 1 })
  expect(result.quickStart.steps).toEqual([false, true, false])
  expect(result.plaques.openings).toEqual([])
})
