import { describe, expect, test } from 'bun:test'
import { messages, resolveLocale, t } from '../src/i18n.js'
import { TITLES } from '../src/core/game.js'

describe('language selection', () => {
  test('uses supported browser language codes and falls back to English', () => {
    expect(resolveLocale('es-PY')).toBe('es')
    expect(resolveLocale('fr-CA')).toBe('fr')
    expect(resolveLocale('de-DE')).toBe('en')
  })

  test('translates navigation and puzzle feedback in all launch languages', () => {
    expect(t('en', 'nav.exercises')).toBe('Puzzles')
    expect(t('fr', 'nav.exercises')).toBe('Exercices')
    expect(t('es', 'nav.exercises')).toBe('Ejercicios')
    expect(t('es', 'exercises.mate', { move: 'Qh7#' })).toContain('Qh7#')
    expect(t('es', 'exercises.mate', { move: 'Qh7#' })).toContain('jaque mate')
  })

  test('reports missing keys during development', () => {
    expect(() => t('en', 'missing.key')).toThrow('Missing translation: missing.key')
  })

  test('keeps every key and placeholder aligned across launch languages', () => {
    const enKeys = Object.keys(messages.en).sort()
    const placeholders = (template) => [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const locale of ['fr', 'es']) {
      expect(Object.keys(messages[locale]).sort()).toEqual(enKeys)
      for (const key of enKeys) expect(placeholders(messages[locale][key])).toEqual(placeholders(messages.en[key]))
    }
  })

  test('the 30-day summary displays a zero count in every language', () => {
    for (const locale of ['en', 'fr', 'es']) expect(t(locale, 'insights.sample', { count: '0' })).toContain('0')
  })

  test('all level titles and daily challenge types have launch translations', () => {
    for (const locale of ['en', 'fr', 'es']) {
      for (const [level] of TITLES) expect(t(locale, `title.${level}`)).toBeTruthy()
      for (const kind of ['due', 'fresh', 'lines', 'flawless', 'combo', 'pick', 'side', 'xp', 'rush', 'puzzles', 'drills', 'newPuzzle']) {
        expect(t(locale, `quest.${kind}`, { count: 3, side: 'White' })).toBeTruthy()
      }
    }
  })
})
