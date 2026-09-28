import { describe, test, expect } from 'bun:test'
import { linesFromTree, lineEnding } from '../src/core/lines.js'
import ALIEN_TREE_DATA from '../catalog/trees/alien-gambit.json'

const ALIEN_TREE = ALIEN_TREE_DATA.tree

// Petit arbre camp noir, fictif : après 1.e4 c6, les Blancs ont 2 choix (2.d4 ou 2.Nc3), et sous
// 2.d4 d5 un 2e choix (3.Nc3 ou 3.e5). 3 lignes, 2 embranchements adverses à des profondeurs
// différentes : de quoi vérifier la généralisation au camp noir et le paramètre definingPly.
const BLACK_TREE = [
  {
    m: 'e4',
    c: [
      {
        m: 'c6',
        c: [
          {
            m: 'd4',
            e: -20,
            c: [
              {
                m: 'd5',
                c: [
                  { m: 'Nc3', alt: ['Nd2'], e: -18, c: [{ m: 'dxe4', c: [{ m: 'Nxe4', e: 5, c: [{ m: 'Nf6', c: [{ m: 'Ng5', e: 30 }] }] }] }] },
                  { m: 'e5', e: 40, c: [{ m: 'dxe5', c: [{ m: 'Qxd1+', e: 0 }] }] },
                ],
              },
            ],
          },
          { m: 'Nc3', e: 15, c: [{ m: 'd5', c: [{ m: 'Nf3', e: 10 }] }] },
        ],
      },
    ],
  },
]

describe('linesFromTree, camp blanc, arbre réel de l\'Alien Gambit', () => {
  const lines = linesFromTree(ALIEN_TREE, 'white')

  test('une ligne par feuille, 84 lignes', () => {
    expect(lines.length).toBe(84)
  })

  test('ids uniques, faits des coups joints par un espace', () => {
    const ids = new Set(lines.map((l) => l.id))
    expect(ids.size).toBe(lines.length)
    expect(lines[0].id).toBe(lines[0].moves.join(' '))
  })

  test('alts et evals alignés sur moves', () => {
    for (const l of lines) {
      expect(l.alts.length).toBe(l.moves.length)
      expect(l.evals.length).toBe(l.moves.length)
    }
  })

  test('un seul embranchement adverse dans tout l\'arbre : le 5e coup noir', () => {
    const groups = new Set(lines.map((l) => l.group))
    expect(groups.has('5…⁠h6')).toBe(true)
    expect(groups.size).toBeGreaterThan(1) // h6 (accepté) + les refus du gambit
  })

  test('la ligne principale (gambit accepté, sans autre embranchement) porte ce groupe comme nom', () => {
    const accepted = lines.filter((l) => l.group === '5…⁠h6')
    expect(accepted.length).toBeGreaterThan(0)
    for (const l of accepted) expect(l.name.startsWith('5…⁠h6')).toBe(true)
  })
})

describe('linesFromTree, camp noir, petit arbre fictif', () => {
  test('3 lignes, groupées par le premier embranchement blanc (2e coup)', () => {
    const lines = linesFromTree(BLACK_TREE, 'black')
    expect(lines.length).toBe(3)
    const byGroup = new Map()
    for (const l of lines) byGroup.set(l.group, (byGroup.get(l.group) || 0) + 1)
    expect(byGroup.get('2.⁠d4')).toBe(2) // d5-Nc3-... et d5-e5-...
    expect(byGroup.get('2.⁠Nc3')).toBe(1)
  })

  test('le nom liste les embranchements successifs, le groupe ne retient que le premier', () => {
    const lines = linesFromTree(BLACK_TREE, 'black')
    const viaNc3 = lines.find((l) => l.moves.includes('dxe4'))
    const viaE5 = lines.find((l) => l.moves.includes('dxe5'))
    expect(viaNc3.name).toBe('2.⁠d4  3.⁠Nc3')
    expect(viaE5.name).toBe('2.⁠d4  3.⁠e5')
    expect(viaNc3.group).toBe('2.⁠d4')
    expect(viaE5.group).toBe('2.⁠d4')
  })

  test('definingPly exclut du nom les embranchements trop précoces', () => {
    const lines = linesFromTree(BLACK_TREE, 'black', { definingPly: 4 })
    const viaNc3 = lines.find((l) => l.moves.includes('dxe4'))
    const viaE5 = lines.find((l) => l.moves.includes('dxe5'))
    const viaOtherNc3 = lines.find((l) => l.moves[2] === 'Nc3')
    expect(viaNc3.name).toBe('3.⁠Nc3')
    expect(viaE5.name).toBe('3.⁠e5')
    // cette ligne n'a pas d'embranchement à partir du pli 4 : elle retombe sur le nom par défaut
    expect(viaOtherNc3.name).toBe('Variante principale')
    expect(viaOtherNc3.group).toBe('Variante principale')
  })

  test('alt et e sont repris tels quels, absents = [] et null', () => {
    const lines = linesFromTree(BLACK_TREE, 'black')
    const viaNc3 = lines.find((l) => l.moves.includes('dxe4'))
    const nc3Index = viaNc3.moves.indexOf('Nc3')
    expect(viaNc3.alts[nc3Index]).toEqual(['Nd2'])
    expect(viaNc3.evals[nc3Index]).toBe(-18)
    expect(viaNc3.alts[0]).toEqual([])
    expect(viaNc3.evals[0]).toBeNull()
  })
})

describe('lineEnding', () => {
  test('position réellement mat : « Échec et mat »', () => {
    expect(lineEnding({ evals: [null, 99900], moves: ['e4', 'x'], side: 'black', checkmate: true })).toEqual({ kind: 'checkmate' })
  })
  test('mat forcé non joué, dernier coup adverse : Mat en N − 1 pour moi', () => {
    // alien-gambit : 35 demi-coups, mon dernier coup (demi-coup 34) évalué mat en 2
    const evals = Array(35).fill(null); evals[34] = 99800
    expect(lineEnding({ evals, moves: Array(35).fill('m'), side: 'white', checkmate: false })).toEqual({ kind: 'mate', mateIn: 1, forMe: true, eval: 99800 })
  })
  test('mat forcé, un coup adverse après mon coup évalué : il ne diminue pas N', () => {
    // ruy-lopez-exchange-variation-alapin-gambit : 17 demi-coups, Noirs, mon coup 15 évalué mat en 4
    const evals = Array(17).fill(null); evals[15] = -99600
    expect(lineEnding({ evals, moves: Array(17).fill('m'), side: 'black', checkmate: false }).mateIn).toBe(3)
  })
  test('éval ordinaire : gagnante au-delà de +3 pour mon camp seulement', () => {
    expect(lineEnding({ evals: [null, -350], moves: ['a', 'b'], side: 'black', checkmate: false })).toEqual({ kind: 'eval', eval: -350, winning: true })
    expect(lineEnding({ evals: [-350], moves: ['a'], side: 'white', checkmate: false }).winning).toBe(false)
    expect(lineEnding({ evals: [null], moves: ['a'], side: 'white', checkmate: false })).toEqual({ kind: 'eval', eval: null, winning: false })
  })
})
