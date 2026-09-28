// Bilan local sur 30 jours. Une seule première tentative par position ou variante et par jour.
import { localDateStr } from './srs.js'

export function recentInsights({ puzzles = [], activity = [], now = Date.now() } = {}) {
  const start = new Date(now)
  start.setDate(start.getDate() - 29)
  const from = localDateStr(start.getTime())
  const to = localDateStr(now)
  const attempts = []
  for (const p of puzzles) {
    if (!p?.ref || !p.theme || !Number.isSafeInteger(p.at)) continue
    attempts.push({ kind: 'theme', group: p.theme, ref: p.ref, day: localDateStr(p.at), at: p.at, id: String(p.id || ''), clean: p.result === 'solved' && p.errors === 0 && !p.aided })
  }
  for (const e of activity) {
    if (e?.kind !== 'line' || !e.data?.o || !e.data?.l || !Number.isSafeInteger(e.at)) continue
    attempts.push({ kind: 'opening', group: e.data.o, ref: e.data.l, day: e.day || localDateStr(e.at), at: e.at, id: String(e.id || ''), clean: e.data.err === 0 && !e.data.aided })
  }
  attempts.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const first = new Set()
  const groups = new Map()
  for (const attempt of attempts) {
    if (attempt.day < from || attempt.day > to) continue
    const key = `${attempt.kind}\0${attempt.ref}\0${attempt.day}`
    if (first.has(key)) continue
    first.add(key)
    const groupKey = `${attempt.kind}\0${attempt.group}`
    const group = groups.get(groupKey) || { kind: attempt.kind, id: attempt.group, count: 0, clean: 0 }
    group.count++
    if (attempt.clean) group.clean++
    groups.set(groupKey, group)
  }
  const all = [...groups.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
  const eligible = all.filter((g) => g.count >= 5)
  const byRate = (a, b) => a.clean / a.count - b.clean / b.count || b.count - a.count || a.id.localeCompare(b.id)
  const strengths = eligible.filter((g) => g.clean / g.count >= 0.8).sort((a, b) => byRate(b, a))
  const weaknesses = eligible.filter((g) => g.clean / g.count < 0.8).sort(byRate)
  return { from, to, all, eligible, strengths, weaknesses, priority: weaknesses[0] || null, strength: strengths[0] || null, count: all.reduce((n, g) => n + g.count, 0) }
}
