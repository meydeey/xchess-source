import { describe, test, expect } from 'bun:test'
import { createPersister } from '../src/platform/persister.js'

// Minuteries factices : le test déclenche lui-même la nouvelle tentative programmée.
function fakeTimers() {
  const queue = new Map()
  let next = 1
  return {
    setTimeout(fn, ms) { const id = next++; queue.set(id, { fn, ms }); return id },
    clearTimeout(id) { queue.delete(id) },
    fireAll() { const all = [...queue.values()]; queue.clear(); for (const t of all) t.fn() },
    get size() { return queue.size },
  }
}
// Store factice : `broken` simule le quota plein ou le fichier en lecture seule.
function fakeStore() {
  const data = new Map()
  return {
    data,
    broken: false,
    async set(key, value) {
      if (this.broken) return false
      data.set(key, value)
      return true
    },
  }
}

describe('createPersister', () => {
  test('écriture acceptée : true, valeur stockée, aucun bandeau', async () => {
    const store = fakeStore()
    const statuses = []
    const p = createPersister({ set: (k, v) => store.set(k, v), onStatus: (ok) => statuses.push(ok), timers: fakeTimers() })
    expect(await p.write('progress', { a: 1 })).toBe(true)
    expect(store.data.get('progress')).toEqual({ a: 1 })
    expect(statuses).toEqual([])
  })

  test('écriture refusée : false, bandeau, nouvelle tentative programmée qui réussit une fois la cause levée', async () => {
    const store = fakeStore()
    store.broken = true
    const statuses = []
    const timers = fakeTimers()
    const p = createPersister({ set: (k, v) => store.set(k, v), onStatus: (ok) => statuses.push(ok), timers })
    expect(await p.write('progress', { a: 1 })).toBe(false)
    expect(statuses).toEqual([false])
    expect(p.failing).toBe(true)
    expect(timers.size).toBe(1)

    store.broken = false
    timers.fireAll()
    await p.retry()
    expect(store.data.get('progress')).toEqual({ a: 1 })
    expect(statuses).toEqual([false, true])
    expect(p.failing).toBe(false)
  })

  test('pendant la panne, seule la dernière valeur de chaque clé est gardée puis écrite', async () => {
    const store = fakeStore()
    store.broken = true
    const p = createPersister({ set: (k, v) => store.set(k, v), timers: fakeTimers() })
    await p.write('progress', { v: 1 })
    await p.write('progress', { v: 2 })
    await p.write('repertoire', ['x'])
    store.broken = false
    expect(await p.retry()).toBe(true)
    expect(store.data.get('progress')).toEqual({ v: 2 })
    expect(store.data.get('repertoire')).toEqual(['x'])
  })

  test('un set qui lève compte comme un refus', async () => {
    const p = createPersister({ set: async () => { throw new Error('disk') }, timers: fakeTimers() })
    expect(await p.write('k', 1)).toBe(false)
    expect(p.failing).toBe(true)
  })

  test('écritures simultanées : jamais 2 à la fois, la dernière valeur de chaque clé gagne', async () => {
    const stored = new Map()
    let active = 0
    let maxActive = 0
    const p = createPersister({
      set: async (k, v) => {
        maxActive = Math.max(maxActive, ++active)
        await new Promise((r) => setTimeout(r, 5))
        stored.set(k, v)
        active--
        return true
      },
      timers: fakeTimers(),
    })
    const r = await Promise.all([p.write('a', 1), p.write('b', 2), p.write('a', 3)])
    expect(r).toEqual([true, true, true])
    expect(maxActive).toBe(1)
    expect(stored.get('a')).toBe(3)
    expect(stored.get('b')).toBe(2)
  })
})
