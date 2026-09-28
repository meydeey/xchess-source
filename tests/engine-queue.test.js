import { describe, test, expect } from 'bun:test'
import { createEngineQueue, queuedEngine } from '../src/platform/engine-queue.js'

// Moteur factice : chaque recherche dure `ms`, compte les recherches simultanées, note l'ordre.
function fakeEngine(ms = 5) {
  const log = []
  let active = 0
  let maxActive = 0
  async function search(tag) {
    maxActive = Math.max(maxActive, ++active)
    log.push(tag)
    await new Promise((r) => setTimeout(r, ms))
    active--
    return tag
  }
  return {
    log,
    get maxActive() { return maxActive },
    analyse: (fen) => search(`analyse:${fen}`),
    bestMove: (fen) => search(`best:${fen}`),
    dispose: async () => {},
  }
}

describe('createEngineQueue / queuedEngine', () => {
  test('10 analyses lancées ensemble : une seule recherche à la fois, chacune reçoit SON résultat', async () => {
    const raw = fakeEngine()
    const engine = queuedEngine(raw)
    const fens = Array.from({ length: 10 }, (_, i) => `p${i}`)
    const results = await Promise.all(fens.map((f) => engine.analyse(f)))
    expect(raw.maxActive).toBe(1)
    expect(results).toEqual(fens.map((f) => `analyse:${f}`))
  })

  test('un coup interactif double les analyses de fond en attente', async () => {
    const raw = fakeEngine()
    const engine = queuedEngine(raw)
    const background = ['a', 'b', 'c'].map((f) => engine.analyse(f))
    const best = engine.bestMove('x')
    await Promise.all([...background, best])
    // 'a' était déjà en cours ; 'x' passe juste après, avant 'b' et 'c'
    expect(raw.log).toEqual(['analyse:a', 'best:x', 'analyse:b', 'analyse:c'])
  })

  test('une analyse demandée en interactif passe aussi devant', async () => {
    const raw = fakeEngine()
    const engine = queuedEngine(raw)
    const all = [engine.analyse('a'), engine.analyse('b'), engine.analyse('hint', { priority: 'interactive' })]
    await Promise.all(all)
    expect(raw.log).toEqual(['analyse:a', 'analyse:hint', 'analyse:b'])
  })

  test('demande annulée avant son tour : jamais lancée, rejet AbortError', async () => {
    const raw = fakeEngine()
    const engine = queuedEngine(raw)
    const ctrl = new AbortController()
    const first = engine.analyse('a')
    const second = engine.analyse('b', { signal: ctrl.signal })
    ctrl.abort()
    await first
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(raw.log).toEqual(['analyse:a'])
  })

  test('demande annulée pendant la recherche : résultat périmé jeté', async () => {
    const raw = fakeEngine(10)
    const engine = queuedEngine(raw)
    const ctrl = new AbortController()
    const p = engine.bestMove('a', { signal: ctrl.signal })
    setTimeout(() => ctrl.abort(), 2)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('une recherche qui échoue ne bloque pas la file', async () => {
    const queue = createEngineQueue()
    const failed = queue.schedule(async () => { throw new Error('sidecar mort') })
    const ok = queue.schedule(async () => 42)
    await expect(failed).rejects.toThrow('sidecar mort')
    expect(await ok).toBe(42)
  })

  test('les options de recherche passent au moteur, sans priority ni signal', async () => {
    let seen = null
    const engine = queuedEngine({ analyse: async (fen, opts) => { seen = opts; return [] }, bestMove: async () => null, dispose: async () => {} })
    await engine.analyse('f', { multipv: 3, depth: 12, priority: 'interactive', signal: new AbortController().signal })
    expect(seen).toEqual({ multipv: 3, depth: 12 })
  })
})
