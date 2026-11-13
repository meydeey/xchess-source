import { JOURNAL_VERSION, validateEvent, sameEvent } from '../core/journal.js'
import { localDateStr } from '../core/srs.js'

const PHASES = new Set(['invitation', 'preparation', 'duel', 'result'])
const content = (event) => ({
  kind: event.kind,
  data: event.kind === 'activity' ? { ...event.data, event: { ...event.data.event, at: 0, day: '' } } : event.data,
})
const equivalent = (a, b) => sameEvent(content(a), content(b))

function eventsFor(fact, device, at) {
  const { seasonId, seasonVersion, encounterId, encounterVersion, attemptId, step, checkpoint, puzzleAttempt } = fact
  if (![seasonId, encounterId, attemptId].every((value) => typeof value === 'string' && value.length > 0)) throw new Error('adventure.invalidFact')
  if (![seasonVersion, encounterVersion].every((value) => Number.isSafeInteger(value) && value > 0) || !Number.isSafeInteger(step) || step < 0 || !PHASES.has(checkpoint?.phase)) throw new Error('adventure.invalidFact')
  const id = ['adventure', seasonId, encounterId, attemptId, String(step)].map(encodeURIComponent).join(':')
  const day = localDateStr(at)
  const envelope = (event) => validateEvent({ id: `activity:${event.id}`, at, day, device, v: JOURNAL_VERSION, kind: 'activity', data: { event } })
  const event = { id, at, day, kind: 'adventure', xp: 0, data: { seasonId, seasonVersion, encounterId, encounterVersion, attemptId, step, checkpoint } }
  const events = [envelope(event)]
  if (puzzleAttempt) {
    if (typeof puzzleAttempt.ref !== 'string' || !puzzleAttempt.ref || !['solved', 'failed'].includes(puzzleAttempt.result)) throw new Error('adventure.invalidFact')
    const data = { ...puzzleAttempt, mode: 'adventure' }
    events.push(validateEvent({ id: `${id}:puzzle`, at, day, device, v: JOURNAL_VERSION, kind: 'puzzle', data }))
    events.push(envelope({ id: `${id}:puzzle-xp`, at, day, kind: 'puzzle', xp: data.result === 'solved' ? (data.errors === 0 ? 10 : 3) : 0, data: { ref: data.ref, result: data.result, errors: data.errors, aided: !!data.aided, cat: data.cat } }))
  }
  return events
}

// Atomic adventure transactions use the existing journal, with no optimistic advancement.
// Each write snapshots its payload; an aborted transaction releases the step for a fresh resume.
export function createAdventureWriter({ journal, getEvents, device, onCommitted = () => {}, onError = () => {}, now = Date.now }) {
  const pending = new Map()
  let chain = Promise.resolve()
  return {
    save(input) {
      let snapshot, events, key
      try {
        snapshot = structuredClone(input)
        events = eventsFor(snapshot, device, now())
        key = events[0].id
        const prior = pending.get(key)
        if (prior) {
          if (!sameEvent(prior.fact, snapshot)) throw new Error('adventure.divergentStep')
          events = prior.events
        } else pending.set(key, { fact: snapshot, events })
      } catch (error) { onError(error); return Promise.resolve(false) }
      const saving = chain.then(async () => {
        const known = new Map(getEvents().map((event) => [event.id, event]))
        const fresh = []
        for (const event of events) {
          const existing = known.get(event.id)
          if (existing && !equivalent(existing, event)) throw new Error('adventure.divergentStep')
          if (!existing) fresh.push(event)
        }
        if (fresh.length) {
          if (!await journal.appendMany(fresh)) throw new Error('adventure.saveError')
          await onCommitted(fresh)
        }
        pending.delete(key)
        return true
      }).catch((error) => {
        pending.delete(key)
        onError(error)
        return false
      })
      chain = saving.then(() => {})
      return saving
    },
  }
}
