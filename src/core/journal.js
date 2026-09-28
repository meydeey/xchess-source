import { localDateStr } from './srs.js'

export const JOURNAL_VERSION = 1
const KINDS = new Set(['legacy', 'line', 'puzzle', 'trap', 'drill', 'endgame', 'game', 'repertoire', 'setting', 'reset', 'activity'])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const safeKey = (value) => typeof value === 'string' && value.length > 0 && !UNSAFE_KEYS.has(value)

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  return value
}

export function sameEvent(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b))
}

export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Événement invalide')
  if (event.v !== JOURNAL_VERSION) throw new Error('Version de sauvegarde inconnue')
  if (typeof event.id !== 'string' || !event.id || event.id.length > 500) throw new Error('Identifiant d’événement invalide')
  if (!Number.isSafeInteger(event.at) || event.at < 0) throw new Error('Date d’événement invalide')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.day)) throw new Error('Jour d’événement invalide')
  if (typeof event.device !== 'string' || !event.device) throw new Error('Appareil d’événement invalide')
  if (!KINDS.has(event.kind)) throw new Error('Type d’événement inconnu')
  if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) throw new Error('Données d’événement invalides')
  return event
}

export function makeEvent(kind, data, device, at = Date.now()) {
  return validateEvent({
    id: crypto.randomUUID(), at, day: localDateStr(at), device, v: JOURNAL_VERSION, kind, data,
  })
}

export function mergeEvents(...groups) {
  const byId = new Map()
  for (const event of groups.flat()) {
    validateEvent(event)
    const existing = byId.get(event.id)
    if (existing && !sameEvent(existing, event)) throw new Error(`Événement divergent : ${event.id}`)
    byId.set(event.id, event)
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

const migrated = (id, kind, data, device, at = 0) => ({
  id, kind, data, device, at, day: localDateStr(at), v: JOURNAL_VERSION,
})

export function migrationEvents({ progress = {}, repertoire = [], settings = {}, activity = [], puzzleAttempts = [] }, device) {
  const events = []
  for (const [openingId, lines] of Object.entries(progress)) {
    for (const [lineId, entry] of Object.entries(lines || {})) {
      events.push(migrated(`legacy:${device}:${openingId}:${lineId}`, 'legacy', { openingId, lineId, entry }, device))
    }
  }
  for (const openingId of new Set(repertoire)) {
    events.push(migrated(`legacy-repertoire:${device}:${openingId}`, 'repertoire', { openingId, present: true }, device))
  }
  for (const [key, value] of Object.entries(settings)) {
    events.push(migrated(`legacy-setting:${device}:${key}`, 'setting', { key, value }, device))
  }
  for (const original of activity) {
    if (!original?.id || !Number.isSafeInteger(original.at)) continue
    events.push(migrated(`activity:${original.id}`, 'activity', { event: original }, 'legacy', original.at))
  }
  puzzleAttempts.forEach((attempt, index) => {
    if (!attempt?.ref || !Number.isSafeInteger(attempt.at)) return
    const { at, ...data } = attempt
    events.push(migrated(`legacy-puzzle:${device}:${index}`, 'puzzle', data, device, at))
  })
  return mergeEvents(events)
}

function validEntry(entry) {
  return entry && typeof entry === 'object' && !Array.isArray(entry) && Number.isFinite(entry.box) && Number.isFinite(entry.runs)
}

export function replayJournal(input, { defaultSettings = {} } = {}) {
  const events = mergeEvents(input)
  const settings = { ...defaultSettings }
  const repertoire = new Set()
  const progress = {}
  const activity = []
  const legacies = new Map()

  // Les 2 appareils peuvent migrer la même ligne : choisir le passage le plus récent, sans
  // additionner les compteurs historiques. L'ordre de réception n'intervient jamais.
  for (const event of events) {
    if (event.kind !== 'legacy') continue
    const { openingId, lineId, entry } = event.data
    if (!safeKey(openingId) || !safeKey(lineId) || !validEntry(entry)) continue
    const key = `${openingId}\u0000${lineId}`
    const previous = legacies.get(key)
    if (!previous || (entry.lastRun || 0) > (previous.data.entry.lastRun || 0) ||
      ((entry.lastRun || 0) === (previous.data.entry.lastRun || 0) && event.id > previous.id)) legacies.set(key, event)
  }
  for (const event of legacies.values()) {
    const { openingId, lineId, entry } = event.data
    ;(progress[openingId] ||= {})[lineId] = structuredClone(entry)
  }

  for (const event of events) {
    const d = event.data
    if (event.kind === 'setting' && safeKey(d.key)) settings[d.key] = d.value
    if (event.kind === 'repertoire' && safeKey(d.openingId)) {
      if (d.present) repertoire.add(d.openingId)
      else repertoire.delete(d.openingId)
    }
    if (event.kind === 'line' && safeKey(d.openingId) && safeKey(d.lineId) && validEntry(d.entry)) {
      const previous = progress[d.openingId]?.[d.lineId]
      const next = structuredClone(d.entry)
      if (previous && Number.isSafeInteger(d.runsDelta) && d.runsDelta >= 0) {
        next.runs = previous.runs + d.runsDelta
        const flawlessDelta = Number.isSafeInteger(d.flawlessDelta) && d.flawlessDelta >= 0 ? d.flawlessDelta : 0
        next.flawless = (previous.flawless || 0) + flawlessDelta
        next.days = [...new Set([...(previous.days || []), ...(next.days || [])])].sort().slice(-90)
        if (previous.introduced && (!next.introduced || previous.introduced < next.introduced)) next.introduced = previous.introduced
      }
      ;(progress[d.openingId] ||= {})[d.lineId] = next
    }
    if (event.kind === 'reset') {
      if (d.scope === 'progress') for (const key of Object.keys(progress)) delete progress[key]
      if (d.scope === 'opening' && safeKey(d.openingId)) delete progress[d.openingId]
    }
    if (event.kind === 'activity' && d.event?.id) activity.push(d.event)
  }
  return { settings, repertoire: [...repertoire], progress, activity }
}

export function exportJournal(events) {
  return JSON.stringify({ format: 'chessorbit-journal', version: JOURNAL_VERSION, events: mergeEvents(events) })
}

export function importJournal(json, existing = []) {
  let parsed
  try { parsed = JSON.parse(json) } catch { throw new Error('Fichier de sauvegarde illisible') }
  if (parsed?.format !== 'chessorbit-journal' || parsed.version !== JOURNAL_VERSION || !Array.isArray(parsed.events)) {
    throw new Error('Format ou version de sauvegarde inconnu')
  }
  return mergeEvents(existing, parsed.events)
}
