// Tests de la logique pure de src/ui/generate.js (génération dans l'app, chantier E1-generation) :
// conversion de tranche et formatage du temps écoulé. runGeneration/mountGeneratePanel dépendent du
// DOM et du singleton platform (moteur embarqué) : ils se vérifient par le smoke test Chrome headless
// et par la mesure sous Bun (docs/reference/contrats.md, section 5 "mode app"), pas ici.
import { describe, test, expect } from 'bun:test'
import { APP_GENERATE_PARAMS, bandArgFor, formatElapsed } from '../src/ui/generate.js'
import { DEFAULT_PARAMS } from '../src/generator/index.js'
import { BANDS } from '../src/core/metrics.js'

describe('bandArgFor', () => {
  test('tranche connue -> { id, ratings } (contrat 14.5 de generateTree)', () => {
    expect(bandArgFor('debutant')).toEqual({ id: 'debutant', ratings: BANDS.debutant.ratings })
    expect(bandArgFor('club')).toEqual({ id: 'club', ratings: BANDS.club.ratings })
  })
  test('tranche absente ou inconnue -> null', () => {
    expect(bandArgFor(null)).toBeNull()
    expect(bandArgFor(undefined)).toBeNull()
    expect(bandArgFor('')).toBeNull()
    expect(bandArgFor('n-existe-pas')).toBeNull()
  })
})

describe('formatElapsed', () => {
  test('sous la minute : secondes seules', () => {
    expect(formatElapsed(0)).toBe('0 s')
    expect(formatElapsed(999)).toBe('1 s')
    expect(formatElapsed(45000)).toBe('45 s')
    expect(formatElapsed(59000)).toBe('59 s')
  })
  test('à la minute et au delà : "M min SS s"', () => {
    expect(formatElapsed(60000)).toBe('1 min 00 s')
    expect(formatElapsed(65000)).toBe('1 min 05 s')
    expect(formatElapsed(600000)).toBe('10 min 00 s')
  })
  test('ne rend jamais un temps négatif (horloge qui recule)', () => {
    expect(formatElapsed(-500)).toBe('0 s')
  })
})

describe('APP_GENERATE_PARAMS', () => {
  test('surcharge movetime et depth seulement, laisse intact ownMovesMax (règle de contenu, section 5)', () => {
    expect(Object.keys(APP_GENERATE_PARAMS).sort()).toEqual(['depth', 'movetime'])
    const merged = { ...DEFAULT_PARAMS, ...APP_GENERATE_PARAMS }
    expect(merged.ownMovesMax).toBe(DEFAULT_PARAMS.ownMovesMax)
    expect(merged.movetime).toBe(APP_GENERATE_PARAMS.movetime)
    expect(merged.depth).toBe(APP_GENERATE_PARAMS.depth)
  })
})
