import { describe, test, expect } from 'bun:test'
import { collectionFor, appearanceState, rabbitAsset, RABBIT_POSES } from '../src/core/appearance.js'

describe('white rabbit collection', () => {
  test('starts with Origin, Current and Club, without granting the selected Code preview', () => {
    const owned = collectionFor([])
    expect(owned.rabbits).toEqual(['origin'])
    expect(owned.boards).toEqual(['current', 'club'])
    expect(appearanceState({ rabbitOutfit: 'code', boardTheme: 'code' }, owned)).toMatchObject({ rabbit: 'origin', board: 'current' })
  })
  test('chapter rewards are permanent, unique and ignore unknown chapters', () => {
    const owned = collectionFor(['club', 'tournament', 'club', 'unknown', 'beyond'])
    expect(owned.rabbits).toEqual(['origin', 'explorer', 'code', 'twilight'])
    expect(owned.boards).toEqual(['current', 'club', 'burrow', 'code', 'passage'])
    expect(collectionFor(['club', 'club'])).toEqual(collectionFor(['club']))
  })
  test('equips only known owned elements and preserves independent preferences', () => {
    const owned = collectionFor(['club', 'tournament'])
    expect(appearanceState({ rabbitOutfit: 'code', boardTheme: 'code', companionVisible: false, companionComments: true, companionAnimations: false }, owned)).toEqual({ rabbit: 'code', board: 'code', visible: false, comments: true, animations: false })
    expect(appearanceState({}, owned)).toEqual({ rabbit: 'origin', board: 'current', visible: true, comments: true, animations: true })
  })
  test('practice skins count distinct solved puzzles, retain earlier successes and accept assisted solves', () => {
    const attempts = Array.from({ length: 30 }, (_, i) => ({ ref: `p${i}`, result: 'solved', cat: 'tactics', aided: true }))
    expect(collectionFor([], { attempts }).rabbits).toEqual(['origin', 'code', 'candy'])
    expect(collectionFor([], { attempts: Array(50).fill(attempts[0]) }).rabbits).toEqual(['origin'])
    expect(collectionFor([], { attempts: attempts.map((a) => ({ ...a, result: 'failed' })) }).rabbits).toEqual(['origin'])
    expect(collectionFor([], { attempts: attempts.slice(0, 10).map((a) => ({ ...a, cat: 'technique' })) }).rabbits).toEqual(['origin', 'egyptian', 'candy'])
    expect(collectionFor([], { attempts: attempts.slice(0, 10).map((a) => ({ ...a, cat: 'attack' })) }).rabbits).toEqual(['origin', 'candy', 'horror'])
    expect(collectionFor([], { attempts: [...attempts, { ...attempts[0], result: 'failed' }] }).rabbits).toContain('code')
  })
  test('assets are constrained to the 7 production appearances and 7 poses', () => {
    expect(RABBIT_POSES).toHaveLength(7)
    for (const pose of RABBIT_POSES) expect(rabbitAsset('origin', pose)).toBe(`companion/origin-${pose}.png`)
    expect(rabbitAsset('../../secret', '<script>')).toBe('companion/origin-idle.png')
  })
})
