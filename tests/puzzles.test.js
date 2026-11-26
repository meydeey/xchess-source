import { describe, expect, test } from 'bun:test'
import { Chess } from 'chess.js'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mateMoves, playUci, puzzleStart, selectPuzzle } from '../src/core/puzzles.js'

const mate = { id: 'mate', fen: '3q1k2/pp6/2p1B1Qp/2Pp4/3b4/7P/P4PP1/6K1 b - - 1 32', moves: ['d8e7', 'g6g8'], themes: ['mateIn1'], cat: 'attack', rating: 900 }
const control = { id: 'control', fen: '8/p6R/kp6/8/1PK2n2/7p/7r/8 b - - 5 45', moves: ['h2e2', 'b4b5', 'a6a5', 'h7a7'], themes: ['mateIn2'], cat: 'attack', rating: 899, control: true }

describe('exercices', () => {
  test('le pack livré respecte son index et couvre les catégories', () => {
    const index = JSON.parse(readFileSync(new URL('../public/packs/index.json', import.meta.url)))
    expect(index.packs).toHaveLength(3)
    const ids = new Set()
    for (const manifest of index.packs) {
      const content = readFileSync(new URL(`../public/packs/${manifest.file}`, import.meta.url))
      const pack = JSON.parse(content)
      expect(content.length).toBe(manifest.bytes)
      expect(createHash('sha256').update(content).digest('hex')).toBe(manifest.sha256)
      expect(pack.puzzles.length).toBe(manifest.count)
      for (const puzzle of pack.puzzles) { expect(ids.has(puzzle.id)).toBe(false); ids.add(puzzle.id) }
      if (manifest.minRating) {
        expect(pack.puzzles.every((p) => p.rating >= 1700 && p.rating < 2800)).toBe(true)
        expect(Object.values(pack.header.coverage).every((count) => count >= 100)).toBe(true)
      } else if (manifest.file === 'puzzles-2026-09.json') {
        expect(pack.puzzles).toHaveLength(10537)
        expect(pack.puzzles.every((p) => p.id.endsWith('@2026-09'))).toBe(true)
        expect(Object.values(pack.header.coverage).every((count) => count >= 2000)).toBe(true)
      } else {
        expect(pack.puzzles.length).toBeGreaterThanOrEqual(2583)
      }
    }
    expect(ids.size).toBeGreaterThanOrEqual(16000)
    const themes = ['fork', 'pin', 'hangingPiece', 'defensiveMove', 'mateIn1', 'mateIn2', 'promotion', 'endgame', 'skewer', 'discoveredAttack']
    const all = index.packs.flatMap((manifest) => JSON.parse(readFileSync(new URL(`../public/packs/${manifest.file}`, import.meta.url))).puzzles)
    for (const theme of themes) expect(all.filter((p) => p.themes.includes(theme)).length).toBeGreaterThanOrEqual(500)
    for (const puzzle of all.filter((p) => p.themes.includes('mateIn1'))) {
      const chess = new Chess(puzzleStart(puzzle).fen)
      expect(playUci(chess, puzzle.moves[1])).toBeTruthy()
      expect(chess.isCheckmate()).toBe(true)
    }
  })
  test('le coup adverse est joué avant que le joueur réponde', () => {
    const start = puzzleStart(mate)
    expect(start.side).toBe('white')
    expect(start.lastMove).toEqual(['d8', 'e7'])
  })
  test('les nouvelles positions conservent des coups légaux', () => {
    const pack = JSON.parse(readFileSync(new URL('../public/packs/puzzles-motifs-2026-10.json', import.meta.url)))
    for (const puzzle of pack.puzzles) {
      const chess = new Chess(puzzle.fen)
      for (const uci of puzzle.moves) {
        expect(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })).toBeTruthy()
      }
    }
  })
  test('tirage par catégorie, proche de la cote, sans répétition récente', () => {
    const pool = [mate, { ...mate, id: 'other', rating: 1300 }, { ...mate, id: 'def', cat: 'defense' }]
    expect(selectPuzzle(pool, { mode: 'attack', target: 900, recent: ['mate'], random: () => 0 }).id).toBe('other')
    expect(selectPuzzle(pool, { mode: 'defense', random: () => 0 }).id).toBe('def')
  })
  test('le tirage explore largement les positions adaptées au niveau', () => {
    const pool = Array.from({ length: 300 }, (_, i) => ({ ...mate, id: `variety-${i}`, rating: i < 30 ? 800 : 950 }))
    expect(selectPuzzle(pool, { mode: 'attack', target: 800, random: () => 0.9 }).rating).toBe(950)
    const recent = pool.slice(0, 299).map((item) => item.id)
    expect(selectPuzzle(pool, { mode: 'attack', target: 800, recent, random: () => 0 })?.id).toBe('variety-299')
  })
  test('Mat en 1 ne propose jamais un contrôle ni une solution qui ne mate pas', () => {
    const wrongTag = { ...control, id: 'wrong-tag', themes: ['mateIn1'], control: false }
    const wrongSolution = { ...mate, id: 'wrong-solution', moves: ['d8e7', 'g6g7'] }
    const pool = [control, wrongTag, wrongSolution, mate]
    expect(mateMoves(puzzleStart(control).fen)).toEqual([])
    for (const turn of [0, 4, 9]) {
      expect(selectPuzzle(pool, { mode: 'mate1', target: 899, turn, random: () => 0 })?.id).toBe('mate')
    }
    expect(selectPuzzle(pool, { mode: 'mate1', recent: ['mate'], random: () => 0 })?.id).toBe('mate')
    expect(selectPuzzle([control, wrongTag, wrongSolution], { mode: 'mate1', random: () => 0 })).toBeNull()
  })
  test('mat en 1 détecté par tous les coups légaux', () => {
    const chess = new Chess()
    for (const san of ['f3', 'e5', 'g4']) chess.move(san)
    expect(mateMoves(chess.fen())).toContain('d8h4')
  })
})
