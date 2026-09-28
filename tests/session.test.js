import { describe, test, expect } from 'bun:test'
import { buildSession, starterRepertoire } from '../src/core/session.js'

const now = 1_000_000

const linesByOpening = {
  'alien-gambit': [{ id: 'ag1' }, { id: 'ag2' }, { id: 'ag3' }],
  'defense-caro-kann': [{ id: 'ck1' }, { id: 'ck2' }],
}

describe('buildSession', () => {
  test('sans progression : tout est neuf, plafonné à newPerDay dans l\'ordre du répertoire', () => {
    const s = buildSession({ repertoire: ['alien-gambit', 'defense-caro-kann'], linesByOpening, progress: {}, now, newPerDay: 3 })
    expect(s.dueCount).toBe(0)
    expect(s.newCount).toBe(3)
    expect(s.total).toBe(3)
    expect(s.queue.map((q) => q.line.id)).toEqual(['ag1', 'ag2', 'ag3'])
    expect(s.queue.every((q) => q.isNew)).toBe(true)
  })

  test('respecte introducedToday : réduit ce qui reste de neuf', () => {
    const s = buildSession({ repertoire: ['alien-gambit'], linesByOpening, progress: {}, now, newPerDay: 3, introducedToday: 2 })
    expect(s.newCount).toBe(1)
    expect(s.queue[0].line.id).toBe('ag1')
  })

  test('introducedToday au delà du plafond : aucune ligne neuve, jamais négatif', () => {
    const s = buildSession({ repertoire: ['alien-gambit'], linesByOpening, progress: {}, now, newPerDay: 3, introducedToday: 9 })
    expect(s.newCount).toBe(0)
    expect(s.total).toBe(0)
  })

  test('les lignes dues passent avant les neuves, ratées avant simplement dues', () => {
    const progress = {
      'alien-gambit': {
        ag1: { box: 2, due: now - 10, lastErrors: 0, runs: 2 }, // due, apprise
        ag2: { box: 1, due: now - 5, lastErrors: 1, runs: 1 }, // due, ratée
      },
    }
    const s = buildSession({ repertoire: ['alien-gambit', 'defense-caro-kann'], linesByOpening, progress, now, newPerDay: 10 })
    expect(s.dueCount).toBe(2)
    expect(s.queue[0].line.id).toBe('ag2') // ratée d'abord
    expect(s.queue[1].line.id).toBe('ag1')
    expect(s.queue[0].isNew).toBe(false)
    // ag3 (neuve) et les 2 lignes de defense-caro-kann (neuves) suivent
    expect(s.queue.slice(2).every((q) => q.isNew)).toBe(true)
    expect(s.newCount).toBe(3)
  })

  test('une ligne maîtrisée non due n\'apparaît pas dans la session', () => {
    const progress = { 'alien-gambit': { ag1: { box: 3, due: now + 999999, lastErrors: 0, runs: 5 } } }
    const s = buildSession({ repertoire: ['alien-gambit'], linesByOpening, progress, now, newPerDay: 0 })
    expect(s.queue.find((q) => q.line.id === 'ag1')).toBeUndefined()
    expect(s.total).toBe(0)
  })

  test('répertoire vide : session vide', () => {
    const s = buildSession({ repertoire: [], linesByOpening, progress: {}, now })
    expect(s).toEqual({ queue: [], dueCount: 0, newCount: 0, total: 0 })
  })

  test('chaque entrée de la file porte l\'identifiant de son ouverture', () => {
    const s = buildSession({ repertoire: ['defense-caro-kann'], linesByOpening, progress: {}, now, newPerDay: 5 })
    expect(s.queue.every((q) => q.openingId === 'defense-caro-kann')).toBe(true)
  })
})

describe('starterRepertoire (D7)', () => {
  const sel = [
    { id: 'anglaise', side: 'white', moves: ['c4'] },
    { id: 'grob', side: 'white', moves: ['g4'] },
    { id: 'italienne', side: 'white', moves: ['e4', 'e5', 'Nf3'] },
    { id: 'caro', side: 'black', moves: ['e4', 'c6'] },
    { id: 'scandinave', side: 'black', moves: ['e4', 'd5'] },
    { id: 'hollandaise', side: 'black', moves: ['d4', 'f5'] },
  ]
  const diff = { anglaise: 3, grob: 3, italienne: 1, caro: 3, scandinave: 4, hollandaise: 3 }
  const score = { anglaise: 0.52, grob: 0.46, italienne: 0.6, caro: 0.5, scandinave: 0.9, hollandaise: 0.47 }
  test('1er coup blanc, réponse à 1.e4, réponse à 1.d4 ; difficulté 3 au plus, meilleur score', () => {
    const out = starterRepertoire(sel, { difficultyOf: (id) => diff[id], scoreOf: (id) => score[id] })
    expect(out.map((o) => o.id)).toEqual(['anglaise', 'caro', 'hollandaise'])
  })
  test('créneau sans candidate : ignoré', () => {
    const out = starterRepertoire(sel.filter((o) => o.id !== 'hollandaise'), { difficultyOf: (id) => diff[id], scoreOf: (id) => score[id] })
    expect(out.map((o) => o.id)).toEqual(['anglaise', 'caro'])
  })
  test('sans candidate de difficulté 1 à 3, choisit la charge minimale puis le meilleur score', () => {
    const hard = { anglaise: 5, grob: 4, caro: 5, scandinave: 5, hollandaise: 4 }
    const out = starterRepertoire(sel, { difficultyOf: (id) => hard[id] ?? null, scoreOf: (id) => score[id] })
    expect(out.map((o) => o.id)).toEqual(['grob', 'scandinave', 'hollandaise'])
  })
})
