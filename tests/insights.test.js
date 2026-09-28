import { test, expect } from 'bun:test'
import { recentInsights } from '../src/core/insights.js'

const now = new Date(2026, 8, 28, 12).getTime()
const day = (delta) => new Date(2026, 8, 28 + delta, 12).getTime()

test('bilan vide et ancien : aucune conclusion', () => {
  expect(recentInsights({ now }).priority).toBeNull()
  expect(recentInsights({ now, puzzles: [{ ref: 'old', theme: 'fork', at: day(-30), result: 'failed' }] }).count).toBe(0)
})

test('première tentative quotidienne, sans erreur ni aide, et seuil de 5', () => {
  const puzzles = Array.from({ length: 5 }, (_, i) => ({ ref: `p${i}`, theme: 'fork', at: day(-i), result: 'solved', errors: i === 0 ? 1 : 0, aided: i === 1 }))
  puzzles.push({ ref: 'p0', theme: 'fork', at: day(0) + 1000, result: 'solved', errors: 0 })
  const insight = recentInsights({ now, puzzles })
  expect(insight.count).toBe(5)
  expect(insight.priority).toMatchObject({ id: 'fork', count: 5, clean: 3 })
})

test('variante et position gardent des clés distinctes, priorité sur les échecs', () => {
  const puzzles = Array.from({ length: 5 }, (_, i) => ({ ref: `p${i}`, theme: 'pin', at: day(-i), result: 'solved', errors: 0 }))
  const activity = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, kind: 'line', at: day(-i), data: { o: 'italian', l: `v${i}`, err: 1, aided: false } }))
  const insight = recentInsights({ now, puzzles, activity })
  expect(insight.priority).toMatchObject({ kind: 'opening', id: 'italian', clean: 0 })
  expect(insight.strength).toMatchObject({ kind: 'theme', id: 'pin', clean: 5 })
})

test('historique abondant : fenêtre bornée, groupes de 4 ignorés et première tentative conservée', () => {
  const puzzles = Array.from({ length: 1000 }, (_, i) => ({ ref: `old-${i}`, theme: 'fork', at: day(-90), result: 'failed' }))
  puzzles.push(...Array.from({ length: 4 }, (_, i) => ({ ref: `new-${i}`, theme: 'pin', at: day(-i), result: 'failed' })))
  const result = recentInsights({ now, puzzles })
  expect(result.count).toBe(4)
  expect(result.eligible).toEqual([])
  expect(result.priority).toBeNull()
})
