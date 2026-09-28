import { describe, test, expect } from 'bun:test'
import { openingStats, aggregateStats, introducedTodayCount, globalStats } from '../src/core/stats.js'
import { recordRun, DAY, localDateStr } from '../src/core/srs.js'

const now = new Date('2026-09-21T10:00:00').getTime()
const lines = [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]

describe('openingStats', () => {
  test('répertoire de lignes sans aucune progression : tout neuf', () => {
    const s = openingStats(lines, {})
    expect(s).toEqual({ runs: 0, flawless: 0, successRate: null, mastered: 0, learning: 0, review: 0, fresh: 3, total: 3 })
  })

  test('compte maîtrisées, en cours, à revoir et neuves séparément', () => {
    const progress = {
      l1: { box: 3, due: 0, lastErrors: 0, runs: 4, flawless: 4 }, // maîtrisée
      l2: { box: 1, due: 0, lastErrors: 0, runs: 1, flawless: 1 }, // en cours (boîte < 3)
      l3: { box: 1, due: 0, lastErrors: 2, runs: 2, flawless: 0 }, // à revoir
    }
    const s = openingStats(lines, progress)
    expect(s.mastered).toBe(1)
    expect(s.learning).toBe(1)
    expect(s.review).toBe(1)
    expect(s.fresh).toBe(0)
    expect(s.total).toBe(3)
  })

  test('taux de réussite sans faute = flawless total / runs total, pas une moyenne de taux par ligne', () => {
    const progress = {
      l1: { box: 3, due: 0, lastErrors: 0, runs: 10, flawless: 10 }, // 100 %
      l2: { box: 1, due: 0, lastErrors: 1, runs: 2, flawless: 0 }, // 0 %
    }
    const s = openingStats(lines, progress)
    expect(s.runs).toBe(12)
    expect(s.flawless).toBe(10)
    expect(s.successRate).toBeCloseTo(10 / 12, 10)
  })

  test('entrée ancienne sans flawless : traitée comme 0, ne plante pas', () => {
    const progress = { l1: { box: 2, due: 0, lastErrors: 0, runs: 5 } } // format d'avant ce chantier
    const s = openingStats(lines, progress)
    expect(s.flawless).toBe(0)
    expect(s.runs).toBe(5)
    expect(s.successRate).toBe(0)
  })

  test('aucune ligne : total et compteurs à 0, taux de réussite indéfini', () => {
    expect(openingStats([], {})).toEqual({ runs: 0, flawless: 0, successRate: null, mastered: 0, learning: 0, review: 0, fresh: 0, total: 0 })
  })
})

describe('aggregateStats', () => {
  test('somme plusieurs ouvertures et recalcule le taux global sur les compteurs bruts', () => {
    const a = openingStats(lines, { l1: { box: 3, due: 0, lastErrors: 0, runs: 10, flawless: 10 } })
    const b = openingStats([{ id: 'm1' }], { m1: { box: 1, due: 0, lastErrors: 1, runs: 10, flawless: 0 } })
    const agg = aggregateStats([a, b])
    expect(agg.runs).toBe(20)
    expect(agg.flawless).toBe(10)
    expect(agg.successRate).toBeCloseTo(0.5, 10)
    expect(agg.total).toBe(4) // 3 lignes de a + 1 de b
    expect(agg.mastered).toBe(1)
  })

  test('liste vide : tout à 0, taux indéfini', () => {
    expect(aggregateStats([])).toEqual({ runs: 0, flawless: 0, successRate: null, mastered: 0, learning: 0, review: 0, fresh: 0, total: 0 })
  })
})

describe('introducedTodayCount', () => {
  test('compte les lignes de tout le répertoire introduites aujourd\'hui, aucune autre', () => {
    const progress = {
      'ouverture-a': {
        l1: { introduced: '2026-09-21' },
        l2: { introduced: '2026-09-20' },
      },
      'ouverture-b': {
        l3: { introduced: '2026-09-21' },
      },
    }
    expect(introducedTodayCount(progress, ['ouverture-a', 'ouverture-b'], now)).toBe(2)
  })

  test('une ouverture du répertoire sans progression encore : ignorée sans planter', () => {
    expect(introducedTodayCount({}, ['ouverture-a'], now)).toBe(0)
  })
})

describe('globalStats : série de jours', () => {
  test('joué aujourd\'hui et les 2 jours précédents : série de 3', () => {
    const progress = { o: { l1: { days: [localDateStr(now - 2 * DAY), localDateStr(now - DAY), localDateStr(now)] } } }
    expect(globalStats({ repertoire: ['o'], progress, now }).streak).toBe(3)
  })

  test('un jour manqué au milieu casse la série : ne compte que depuis la reprise', () => {
    const progress = { o: { l1: { days: [localDateStr(now - 5 * DAY), localDateStr(now - DAY), localDateStr(now)] } } }
    expect(globalStats({ repertoire: ['o'], progress, now }).streak).toBe(2)
  })

  test('rien joué aujourd\'hui mais hier oui : la série d\'hier compte encore', () => {
    const progress = { o: { l1: { days: [localDateStr(now - 2 * DAY), localDateStr(now - DAY)] } } }
    expect(globalStats({ repertoire: ['o'], progress, now }).streak).toBe(2)
  })

  test('rien joué aujourd\'hui ni hier : série cassée, 0', () => {
    const progress = { o: { l1: { days: [localDateStr(now - 3 * DAY)] } } }
    expect(globalStats({ repertoire: ['o'], progress, now }).streak).toBe(0)
  })

  test('aucun jour actif : série à 0', () => {
    expect(globalStats({ repertoire: ['o'], progress: { o: {} }, now }).streak).toBe(0)
  })

  test('changement de jour : recordRun réel sur 3 jours consécutifs produit une série de 3', () => {
    let day1 = recordRun({}, 'l1', 0, now - 2 * DAY)
    day1 = recordRun(day1, 'l1', 0, now - DAY)
    day1 = recordRun(day1, 'l1', 0, now)
    expect(globalStats({ repertoire: ['o'], progress: { o: day1 }, now }).streak).toBe(3)
  })
})

describe('globalStats : jours actifs sur 30 jours', () => {
  test('compte les jours distincts dans la fenêtre de 30 jours, ignore ce qui est plus ancien', () => {
    const progress = { o: { l1: { days: [localDateStr(now - 40 * DAY), localDateStr(now - 10 * DAY), localDateStr(now - 1 * DAY), localDateStr(now)] } } }
    expect(globalStats({ repertoire: ['o'], progress, now }).activeDays30).toBe(3)
  })

  test('plusieurs lignes le même jour ne comptent qu\'une fois', () => {
    const progress = { o: { l1: { days: [localDateStr(now)] }, l2: { days: [localDateStr(now)] } } }
    expect(globalStats({ repertoire: ['o'], progress, now }).activeDays30).toBe(1)
  })
})

describe('globalStats : lignes introduites aujourd\'hui', () => {
  test('rend le même compte que introducedTodayCount', () => {
    const progress = { o: { l1: { introduced: localDateStr(now) }, l2: { introduced: localDateStr(now - DAY) } } }
    expect(globalStats({ repertoire: ['o'], progress, now }).introducedToday).toBe(1)
  })
})

describe('globalStats : entrées anciennes sans champs de statistiques', () => {
  test('entrée sans days ni introduced (format d\'avant ce chantier) : ignorée, ne plante pas', () => {
    const progress = { o: { l1: { box: 2, due: 0, lastErrors: 0, runs: 5 } } }
    const s = globalStats({ repertoire: ['o'], progress, now })
    expect(s).toEqual({ streak: 0, activeDays30: 0, introducedToday: 0 })
  })

  test('répertoire vide : tout à 0', () => {
    expect(globalStats({ repertoire: [], progress: {}, now })).toEqual({ streak: 0, activeDays30: 0, introducedToday: 0 })
  })
})
