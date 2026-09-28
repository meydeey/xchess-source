// Cartes de maîtrise : preuves dérivées des premières tentatives quotidiennes du journal local.
import { localDateStr, DAY } from './srs.js'

export const MASTERY_THEMES = ['fork', 'pin', 'hangingPiece', 'defensiveMove', 'mateIn1', 'mateIn2', 'promotion', 'endgame', 'skewer', 'discoveredAttack']
const THEME_SET = new Set(MASTERY_THEMES)
const LEVELS = [
  { count: 1, days: 1, clean: 0, delay: 0 },
  { count: 5, days: 2, clean: 0, delay: 0 },
  { count: 10, days: 4, clean: 7, delay: 0 },
  { count: 20, days: 7, clean: 16, delay: DAY },
  { count: 40, days: 14, clean: 34, delay: 7 * DAY },
]

const validTime = (at) => Number.isSafeInteger(at) && at >= 0
function attemptsOf(puzzles, activity) {
  const rows = []
  for (const p of puzzles) {
    if (!p?.ref || !THEME_SET.has(p.theme) || !validTime(p.at)) continue
    rows.push({ kind: 'theme', id: p.theme, ref: String(p.ref), at: p.at, day: p.day || localDateStr(p.at), eventId: String(p.id || ''), clean: p.result === 'solved' && p.errors === 0 && !p.aided })
  }
  for (const e of activity) {
    if (e?.kind !== 'line' || !e.data?.o || !e.data?.l || !validTime(e.at)) continue
    rows.push({ kind: 'opening', id: e.data.o, ref: String(e.data.l), at: e.at, day: e.day || localDateStr(e.at), eventId: String(e.id || ''), clean: e.data.err === 0 && !e.data.aided })
  }
  rows.sort((a, b) => a.at - b.at || a.eventId.localeCompare(b.eventId))
  const seen = new Set()
  return rows.filter((row) => {
    const key = `${row.kind}\0${row.kind === 'opening' ? `${row.id}\0` : ''}${row.ref}\0${row.day}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasRecall(rows, delay) {
  const first = new Map()
  for (const row of rows) {
    if (row.clean && first.has(row.ref) && row.at - first.get(row.ref) >= delay) return true
    if (!first.has(row.ref)) first.set(row.ref, row.at)
  }
  return false
}

function qualifies(rows, end, level, recalls) {
  const rule = LEVELS[level - 1]
  if (end < rule.count) return false
  const window = rows.slice(end - rule.count, end)
  return new Set(window.map((row) => row.day)).size >= rule.days &&
    window.filter((row) => row.clean).length >= rule.clean &&
    (!rule.delay || recalls[rule.delay])
}

function nextProof(rows, level) {
  if (level === 5) return null
  const rule = LEVELS[level]
  const window = rows.slice(-rule.count)
  const count = window.length
  const days = new Set(window.map((row) => row.day)).size
  const clean = window.filter((row) => row.clean).length
  if (count < rule.count) return { kind: 'attempts', count, target: rule.count }
  if (days < rule.days) return { kind: 'days', count: days, target: rule.days }
  if (clean < rule.clean) return { kind: 'clean', count: clean, target: rule.clean }
  if (rule.delay && !hasRecall(rows, rule.delay)) return { kind: rule.delay === DAY ? 'recall24' : 'recall7' }
  return { kind: 'attempts', count, target: rule.count }
}

export function deriveMastery({ puzzles = [], activity = [], now = Date.now() } = {}) {
  const groups = new Map(MASTERY_THEMES.map((id) => [`theme\0${id}`, { kind: 'theme', id, attempts: [] }]))
  for (const row of attemptsOf(puzzles, activity)) {
    const key = `${row.kind}\0${row.id}`
    if (!groups.has(key)) groups.set(key, { kind: row.kind, id: row.id, attempts: [] })
    groups.get(key).attempts.push(row)
  }
  const from = new Date(now)
  from.setDate(from.getDate() - 29)
  const firstDay = localDateStr(from.getTime())
  const lastDay = localDateStr(now)
  const cards = [...groups.values()].filter((group) => group.kind === 'theme' || group.attempts.length).map((group) => {
    const rows = group.attempts
    let level = 0
    const firstAt = new Map()
    const recalls = { [DAY]: false, [7 * DAY]: false }
    // Une fenêtre acquise à n'importe quel moment reste acquise, même après une série moins bonne.
    for (let end = 1; end <= rows.length; end++) {
      const row = rows[end - 1]
      const start = firstAt.get(row.ref)
      if (row.clean && start !== undefined) {
        if (row.at - start >= DAY) recalls[DAY] = true
        if (row.at - start >= 7 * DAY) recalls[7 * DAY] = true
      }
      if (start === undefined) firstAt.set(row.ref, row.at)
      for (let candidate = level + 1; candidate <= 5; candidate++) {
        if (qualifies(rows, end, candidate, recalls)) level = candidate
      }
    }
    const recent = rows.filter((row) => row.day >= firstDay && row.day <= lastDay)
    const clean = recent.filter((row) => row.clean).length
    const rate = recent.length >= 5 ? clean / recent.length : null
    return { kind: group.kind, id: group.id, level, attempts: rows.length, lastAt: rows.at(-1)?.at || null, recent: { count: recent.length, clean, rate }, revive: level > 0 && rate !== null && rate < 0.8, next: nextProof(rows, level), href: group.kind === 'theme' ? `#/exercises/theme/${encodeURIComponent(group.id)}` : `#/train/${encodeURIComponent(group.id)}` }
  })
  const practiced = cards.filter((card) => card.attempts)
  const steps = [
    puzzles.some((p) => p?.ref && validTime(p.at)),
    activity.some((e) => e?.kind === 'line' && e.data?.o && e.data?.l && validTime(e.at)),
    puzzles.some((p) => p?.ref && validTime(p.at) && p.result === 'solved' && p.errors === 0 && !p.aided),
  ]
  return { cards, byKey: new Map(cards.map((card) => [`${card.kind}\0${card.id}`, card])), practiced, quickStart: { steps, complete: steps.every(Boolean) }, plaques: { quickStart: steps.every(Boolean), themes: practiced.filter((card) => card.kind === 'theme' && card.level === 5).map((card) => card.id), openings: practiced.filter((card) => card.kind === 'opening' && card.level === 5).map((card) => card.id) } }
}
