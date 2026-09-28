import { describe, test, expect } from 'bun:test'
import {
  knownPrefixLength,
  phasesFor,
  showCardAt,
  countsErrors,
  markWeak,
  clearWeak,
  explainKeyFor,
} from '../src/core/learn.js'

describe('knownPrefixLength', () => {
  const a = { id: 'e4 c6 d4 d5', moves: ['e4', 'c6', 'd4', 'd5'] }
  const b = { id: 'e4 c6 d4 e5', moves: ['e4', 'c6', 'd4', 'e5'] }
  const c = { id: 'e4 e5', moves: ['e4', 'e5'] }
  const lines = [a, b, c]

  test('aucune autre ligne jouée : préfixe 0', () => {
    expect(knownPrefixLength(a, lines, {})).toBe(0)
  })

  test('une autre ligne jouée avec un préfixe commun : la longueur du préfixe partagé', () => {
    const progress = { [b.id]: { box: 1, due: 0, lastErrors: 0, runs: 1 } }
    expect(knownPrefixLength(a, lines, progress)).toBe(3) // e4 c6 d4 commun, d5 vs e5 diffère
  })

  test('plusieurs lignes jouées : retient le plus long préfixe commun', () => {
    const progress = {
      [c.id]: { box: 1, due: 0, lastErrors: 0, runs: 1 }, // e4 seul en commun
      [b.id]: { box: 1, due: 0, lastErrors: 0, runs: 1 }, // e4 c6 d4 en commun
    }
    expect(knownPrefixLength(a, lines, progress)).toBe(3)
  })

  test('la ligne elle-même, même si présente dans progress, ne compte pas', () => {
    const progress = { [a.id]: { box: 3, due: 0, lastErrors: 0, runs: 5 } }
    expect(knownPrefixLength(a, lines, progress)).toBe(0)
  })

  test('une ligne jouée sans aucun coup commun : préfixe 0', () => {
    const other = { id: 'd4 d5', moves: ['d4', 'd5'] }
    const progress = { [other.id]: { box: 1, due: 0, lastErrors: 0, runs: 1 } }
    expect(knownPrefixLength(a, [a, other], progress)).toBe(0)
  })

  test('progress omis : rend 0 sans planter', () => {
    expect(knownPrefixLength(a, lines)).toBe(0)
  })
})

describe('phasesFor', () => {
  test('new : Découvrir puis Rappeler', () => {
    expect(phasesFor('new')).toEqual(['discover', 'recall'])
  })
  test('review, learning ou mastered (ligne due ou ratée) : Réviser seul', () => {
    expect(phasesFor('review')).toEqual(['review'])
    expect(phasesFor('learning')).toEqual(['review'])
    expect(phasesFor('mastered')).toEqual(['review'])
  })
})

describe('showCardAt', () => {
  test("discover : fiche à partir du préfixe déjà connu, pour les 2 camps", () => {
    expect(showCardAt('discover', 0, 'white', { knownPrefix: 3 })).toBe(false)
    expect(showCardAt('discover', 2, 'white', { knownPrefix: 3 })).toBe(false)
    expect(showCardAt('discover', 3, 'white', { knownPrefix: 3 })).toBe(true)
    expect(showCardAt('discover', 3, 'black', { knownPrefix: 3 })).toBe(true) // pas restreint à mon camp
  })
  test('discover sans préfixe connu : fiche dès le premier demi-coup', () => {
    expect(showCardAt('discover', 0, 'white', {})).toBe(true)
  })
  test('recall : jamais de fiche avant le coup, même sur un demi-coup marqué faible', () => {
    expect(showCardAt('recall', 0, 'white', { knownPrefix: 0, weak: [0] })).toBe(false)
    expect(showCardAt('recall', 5, 'black', {})).toBe(false)
  })
  test('recall : une erreur montre la fiche du bon coup (spec 15.1)', () => {
    expect(showCardAt('recall', 0, 'white', { justErred: true })).toBe(true)
    expect(showCardAt('recall', 5, 'black', { justErred: false })).toBe(false)
  })
  test('review : seulement mes coups marqués faibles', () => {
    expect(showCardAt('review', 4, 'white', { weak: [4] })).toBe(true) // pli 4 pair = Blancs
    expect(showCardAt('review', 5, 'white', { weak: [5] })).toBe(false) // pli impair = pas mon coup
    expect(showCardAt('review', 4, 'white', { weak: [6] })).toBe(false) // pas dans weak
    expect(showCardAt('review', 5, 'black', { weak: [5] })).toBe(true) // pli impair = Noirs
  })
  test('review sans weak : jamais de fiche', () => {
    expect(showCardAt('review', 4, 'white', {})).toBe(false)
  })
})

describe('countsErrors', () => {
  test('discover ne compte jamais une faute', () => {
    expect(countsErrors('discover')).toBe(false)
  })
  test('recall et review comptent une faute', () => {
    expect(countsErrors('recall')).toBe(true)
    expect(countsErrors('review')).toBe(true)
  })
})

describe('markWeak / clearWeak', () => {
  test('markWeak ajoute un demi-coup absent', () => {
    expect(markWeak([], 4)).toEqual([4])
    expect(markWeak([2], 4)).toEqual([2, 4])
  })
  test('markWeak trie et ne double jamais une entrée', () => {
    expect(markWeak([6], 2)).toEqual([2, 6])
    expect(markWeak([2, 6], 2)).toEqual([2, 6])
  })
  test('markWeak(undefined, ply) : part de [] (rétrocompatible)', () => {
    expect(markWeak(undefined, 4)).toEqual([4])
  })
  test('clearWeak retire un demi-coup présent, laisse les autres', () => {
    expect(clearWeak([2, 4, 6], 4)).toEqual([2, 6])
  })
  test('clearWeak sur une entrée absente : ne change rien', () => {
    expect(clearWeak([2, 6], 4)).toEqual([2, 6])
  })
  test('clearWeak(undefined, ply) : part de [] (rétrocompatible)', () => {
    expect(clearWeak(undefined, 4)).toEqual([])
  })
})

describe('explainKeyFor', () => {
  const moves = ['e4', 'c6', 'd4', 'd5', 'Nc3']
  test('clé = les coups depuis le début, séparés par une espace, jusqu\'au pli inclus', () => {
    expect(explainKeyFor(moves, 0)).toBe('e4')
    expect(explainKeyFor(moves, 2)).toBe('e4 c6 d4')
    expect(explainKeyFor(moves, 4)).toBe('e4 c6 d4 d5 Nc3')
  })
})
