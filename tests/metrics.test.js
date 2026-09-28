import { describe, test, expect } from 'bun:test'
import { BANDS, score, wilsonLow, bandStats, difficulty, eloToBand } from '../src/core/metrics.js'

describe('BANDS', () => {
  test('5 tranches dans l’ordre croissant', () => {
    expect(Object.keys(BANDS)).toEqual(['debutant', 'intermediaire', 'club', 'avance', 'expert'])
  })
  test('bornes contiguës, moins de 1200 pour debutant', () => {
    expect(BANDS.debutant.max).toBe(1199)
    expect(BANDS.intermediaire.min).toBe(1200)
    expect(BANDS.expert.max).toBe(Infinity)
  })
})

describe('score', () => {
  test('victoire nette', () => {
    expect(score(10, 0, 0)).toBe(1)
  })
  test('défaite nette', () => {
    expect(score(0, 0, 10)).toBe(0)
  })
  test('moitié de nulles compte pour une demi-victoire', () => {
    expect(score(0, 10, 0)).toBe(0.5)
  })
  test('mélange', () => {
    expect(score(60, 20, 20)).toBeCloseTo(0.7, 10)
  })
  test('0 partie : 0 conventionnel, pas de NaN', () => {
    expect(score(0, 0, 0)).toBe(0)
  })
})

describe('wilsonLow', () => {
  test('0 partie : 0, pas de division par zéro', () => {
    expect(wilsonLow(0, 0)).toBe(0)
  })
  test('borne basse toujours entre 0 et le score', () => {
    const low = wilsonLow(0.6, 40)
    expect(low).toBeGreaterThan(0)
    expect(low).toBeLessThan(0.6)
  })
  test('écrase un score extrême sur peu de parties', () => {
    // 60% sur 40 parties ne prouve rien : la borne basse tombe largement sous 50%.
    expect(wilsonLow(0.6, 40)).toBeLessThan(0.5)
  })
  test('un score élevé sur beaucoup de parties reste crédible', () => {
    // 60% sur 5000 parties est une preuve solide : la borne basse reste proche de 60%.
    expect(wilsonLow(0.6, 5000)).toBeGreaterThan(0.58)
  })
  test('converge vers le score quand n grandit', () => {
    const low1000 = wilsonLow(0.5, 1000)
    const low100000 = wilsonLow(0.5, 100000)
    expect(low100000).toBeGreaterThan(low1000)
    expect(low100000).toBeCloseTo(0.5, 2)
  })
})

describe('bandStats', () => {
  const parent = { white: 600, draws: 300, black: 100 } // score blancs élevé avant ce coup
  const child = { white: 550, draws: 250, black: 200 } // le coup mesuré, un peu moins bon

  test('camp blancs : score, scoreLow, baseline, gain', () => {
    const s = bandStats(parent, child, 'white')
    expect(s.games).toBe(1000)
    expect(s.score).toBeCloseTo(score(550, 250, 200), 10)
    expect(s.baseline).toBeCloseTo(score(600, 300, 100), 10)
    expect(s.gain).toBeCloseTo(s.score - s.baseline, 10)
    expect(s.scoreLow).toBeLessThan(s.score)
  })

  test('camp noirs : victoires et défaites inversées', () => {
    const s = bandStats(parent, child, 'black')
    expect(s.score).toBeCloseTo(score(200, 250, 550), 10)
    expect(s.baseline).toBeCloseTo(score(100, 300, 600), 10)
  })

  test('0 partie sur le coup mesuré : pas de crash, score et gain à 0', () => {
    const s = bandStats(parent, { white: 0, draws: 0, black: 0 }, 'white')
    expect(s.games).toBe(0)
    expect(s.score).toBe(0)
    expect(s.scoreLow).toBe(0)
    expect(s.gain).toBe(0 - s.baseline)
  })
})

describe('difficulty', () => {
  test('arbre léger, peu tranchant, stable : difficulté minimale', () => {
    const d = difficulty({ lines: 5, avgOwnMoves: 3, forcedShare: 0.02, medianFinalEval: 80 })
    expect(d).toBe(1)
  })
  test('arbre lourd, très tranchant, fragile : difficulté maximale', () => {
    const d = difficulty({ lines: 500, avgOwnMoves: 10, forcedShare: 0.6, medianFinalEval: -300 })
    expect(d).toBe(5)
  })
  test('reste dans 1 à 5', () => {
    const d = difficulty({ lines: 1, avgOwnMoves: 1, forcedShare: 0, medianFinalEval: 1000 })
    expect(d).toBeGreaterThanOrEqual(1)
    expect(d).toBeLessThanOrEqual(5)
  })
  test('une évaluation défavorable ne change pas la charge à mémoriser', () => {
    const metrics = { lines: 50, avgOwnMoves: 8, forcedShare: 0.2 }
    expect(difficulty({ ...metrics, medianFinalEval: -300 })).toBe(difficulty({ ...metrics, medianFinalEval: 300 }))
  })
})

describe('eloToBand', () => {
  test('400 Elo Chess.com donne debutant', () => {
    expect(eloToBand(400, 'chesscom')).toBe('debutant')
  })
  test('Elo Lichess direct, sans décalage', () => {
    expect(eloToBand(400, 'lichess')).toBe('debutant')
    expect(eloToBand(1600, 'lichess')).toBe('club')
    expect(eloToBand(2300, 'lichess')).toBe('expert')
  })
  test('source par défaut : lichess', () => {
    expect(eloToBand(1300)).toBe('intermediaire')
  })
  test('FIDE club (1700) monte au dessus de debutant', () => {
    expect(eloToBand(1700, 'fide')).not.toBe('debutant')
  })
  test('borne : 1199 Lichess est encore debutant, 1200 passe intermediaire', () => {
    expect(eloToBand(1199, 'lichess')).toBe('debutant')
    expect(eloToBand(1200, 'lichess')).toBe('intermediaire')
  })
})
