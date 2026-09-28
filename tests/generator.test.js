// Tests du générateur d'arbre (src/generator/index.js), moteur et explorateur factices et
// déterministes : aucun accès réseau, aucun vrai Stockfish. Positions réelles produites par
// chess.js pour que les FEN utilisées comme clés de fixtures soient toujours valides.
import { describe, test, expect } from 'bun:test'
import { Chess } from 'chess.js'
import { generateTree, DEFAULT_PARAMS } from '../src/generator/index.js'

const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ')
const fenAfter = (...sans) => {
  const c = new Chess()
  for (const s of sans) c.move(s)
  return c.fen()
}

// byPos : { [posKey]: [{ uci, score, mate? }, ...] } déjà trié meilleur coup d'abord.
// Lève une erreur si la position n'a pas été prévue, pour repérer un appel inattendu.
function fakeEngine(byPos) {
  const calls = []
  return {
    calls,
    async analyse(fen, opts) {
      calls.push({ fen, ...opts })
      const key = posKey(fen)
      const entry = byPos[key]
      if (!entry) throw new Error(`fakeEngine: aucune donnée pour ${key}`)
      let list = entry
      if (opts.searchmoves && opts.searchmoves.length) list = entry.filter((m) => opts.searchmoves.includes(m.uci))
      return list.slice(0, opts.multipv || 1).map((m) => ({ uci: m.uci, score: m.score, mate: m.mate ?? null }))
    },
  }
}

// byPos : { [posKey]: { white, draws, black, moves: [{ uci, san, white, draws, black }] } }.
// Position absente : renvoie une réponse vide (comme le ferait le vrai explorateur sur une
// position exotique), ce qui déclenche naturellement l'arrêt stopGames.
function fakeExplorer(byPos) {
  const calls = []
  return {
    calls,
    async query({ fen, ratings }) {
      calls.push({ fen, ratings })
      return byPos[posKey(fen)] || { white: 0, draws: 0, black: 0, moves: [] }
    },
  }
}

describe('generateTree', () => {
  test('ligne de définition plus longue que ownMovesMax : jouée en entier, sans analyse', async () => {
    const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']
    const engine = fakeEngine({})
    const { tree, header } = await generateTree({ id: 'long', name: 'Long', side: 'black', moves }, { engine, explorer: null, params: { ownMovesMax: 2 } })
    const path = []
    for (let nodes = tree; nodes?.length; nodes = nodes[0].c) path.push(nodes[0].m)
    expect(path).toEqual(moves)
    expect(header.metrics.lines).toBe(1)
    expect(engine.calls).toHaveLength(0)
  })

  test('DEFAULT_PARAMS conforme à la section 14.5 de la spec', () => {
    expect(DEFAULT_PARAMS).toEqual({
      ownMovesMax: 12,
      minShare: 0.05,
      minGames: 200,
      stopGames: 50,
      maxReplies: 4,
      tolerance: 70,
      movetime: 800,
      depth: 16,
      maxLines: 150,
    })
  })

  test('impose les coups des deux camps sur la ligne, puis arrêt décisif hors mat', async () => {
    const opening = { id: 'prefix-test', name: 'Test préfixe', side: 'white', moves: ['e4', 'e5', 'Nf3', 'Nc6'] }
    const fen = fenAfter('e4', 'e5', 'Nf3', 'Nc6')
    const engine = fakeEngine({
      [posKey(fen)]: [{ uci: 'f1c4', score: 700 }, { uci: 'b1c3', score: 650 }, { uci: 'f1b5', score: 600 }],
    })

    const { header, tree } = await generateTree(opening, { engine, explorer: null })

    expect(tree).toHaveLength(1)
    let node = tree[0]
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) {
      expect(node.m).toBe(san)
      expect(node.e).toBeUndefined()
      expect(node.alt).toBeUndefined()
      node = node.c[0]
    }
    expect(node.m).toBe('Bc4')
    expect(node.e).toBe(700)
    expect(node.alt).toEqual(['Nc3']) // Bb5 (600) sort de la tolérance de 70cp
    expect(node.c).toBeUndefined() // arrêt décisif : +700 pour les Blancs, pas de mat

    expect(header.id).toBe('prefix-test')
    expect(header.side).toBe('white')
    expect(header.metrics).toEqual({ lines: 1, positions: 5, avgOwnMoves: 3, forcedShare: 0, medianFinalEval: 700 })
  })

  test('camp noir, sans explorateur : largeur 3 des réponses adverses, alt, arrêt ownMovesMax', async () => {
    const opening = { id: 'noir-test', name: 'Test noir', side: 'black', moves: ['e4'] }
    const posMine = fenAfter('e4')
    const posAdverse = fenAfter('e4', 'e5')
    const posA = fenAfter('e4', 'e5', 'Nf3')
    const posB = fenAfter('e4', 'e5', 'Bc4')
    const posC = fenAfter('e4', 'e5', 'Nc3')
    const engine = fakeEngine({
      [posKey(posMine)]: [{ uci: 'e7e5', score: 0 }, { uci: 'c7c5', score: 5 }, { uci: 'e7e6', score: 10 }],
      [posKey(posAdverse)]: [{ uci: 'g1f3', score: 30 }, { uci: 'f1c4', score: 25 }, { uci: 'b1c3', score: 15 }],
      [posKey(posA)]: [{ uci: 'b8c6', score: 10 }],
      [posKey(posB)]: [{ uci: 'b8c6', score: 20 }],
      [posKey(posC)]: [{ uci: 'g8f6', score: 30 }],
    })

    const { header, tree } = await generateTree(opening, { engine, explorer: null, params: { ownMovesMax: 2 } })

    expect(tree).toHaveLength(1)
    const e5node = tree[0].c[0]
    expect(e5node.m).toBe('e5')
    expect(e5node.e).toBe(0)
    expect(e5node.alt).toEqual(['c5', 'e6'])
    expect(e5node.c.map((n) => n.m)).toEqual(['Nf3', 'Bc4', 'Nc3']) // largeur 3 au premier coup adverse
    for (const n of e5node.c) {
      expect(n.f).toBeUndefined()
      expect(n.g).toBeUndefined()
      expect(n.c).toHaveLength(1)
      expect(n.c[0].c).toBeUndefined() // arrêt ownMovesMax après le 2e coup noir
    }
    expect(e5node.c[0].c[0]).toEqual({ m: 'Nc6', e: 10 })
    expect(e5node.c[1].c[0]).toEqual({ m: 'Nc6', e: 20 })
    expect(e5node.c[2].c[0]).toEqual({ m: 'Nf6', e: 30 })

    expect(header.side).toBe('black')
    expect(header.metrics).toEqual({ lines: 3, positions: 6, avgOwnMoves: 2, forcedShare: 0.75, medianFinalEval: -20 })
  })

  test('sans explorateur : la largeur des réponses adverses rétrécit 3 puis 2 puis 1', async () => {
    const opening = { id: 'largeur-test', name: 'Test largeur', side: 'black', moves: ['e4'] }
    const posMine1 = fenAfter('e4')
    const posAdverse1 = fenAfter('e4', 'e5')
    const posA = fenAfter('e4', 'e5', 'Nf3')
    const posAdverse2 = fenAfter('e4', 'e5', 'Nf3', 'Nc6')
    const posB1 = fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bc4')
    const posAdverse3 = fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6')
    const posC1 = fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'd3')
    const posB2 = fenAfter('e4', 'e5', 'Nf3', 'Nc6', 'Bb5')
    const posTopBc4 = fenAfter('e4', 'e5', 'Bc4')
    const posTopNc3 = fenAfter('e4', 'e5', 'Nc3')
    const engine = fakeEngine({
      [posKey(posMine1)]: [{ uci: 'e7e5', score: 0 }, { uci: 'c7c5', score: 5 }, { uci: 'e7e6', score: 10 }],
      [posKey(posAdverse1)]: [{ uci: 'g1f3', score: 30 }, { uci: 'f1c4', score: 25 }, { uci: 'b1c3', score: 15 }],
      [posKey(posA)]: [{ uci: 'b8c6', score: 10 }],
      [posKey(posAdverse2)]: [{ uci: 'f1c4', score: 20 }, { uci: 'f1b5', score: 15 }], // largeur 2 attendue
      [posKey(posB1)]: [{ uci: 'g8f6', score: 20 }],
      [posKey(posAdverse3)]: [{ uci: 'd2d3', score: 25 }], // largeur 1 attendue
      [posKey(posC1)]: [{ uci: 'f8e7', score: 30 }],
      [posKey(posB2)]: [{ uci: 'a7a6', score: -700 }], // arrêt décisif, referme cette branche
      [posKey(posTopBc4)]: [{ uci: 'g8f6', score: -700 }],
      [posKey(posTopNc3)]: [{ uci: 'g8f6', score: -700 }],
    })

    const { header, tree } = await generateTree(opening, { engine, explorer: null, params: { ownMovesMax: 4 } })

    const e5node = tree[0].c[0]
    expect(e5node.c.map((n) => n.m)).toEqual(['Nf3', 'Bc4', 'Nc3']) // 1er coup adverse : largeur 3
    const nc6node = e5node.c[0].c[0]
    expect(nc6node.m).toBe('Nc6')
    expect(nc6node.c.map((n) => n.m)).toEqual(['Bc4', 'Bb5']) // 2e coup adverse : largeur 2
    const nf6node = nc6node.c[0].c[0]
    expect(nf6node.m).toBe('Nf6')
    expect(nf6node.c.map((n) => n.m)).toEqual(['d3']) // 3e coup adverse : largeur 1
    expect(nf6node.c[0].c[0]).toEqual({ m: 'Be7', e: 30 }) // arrêt ownMovesMax
    expect(nc6node.c[1].c[0]).toEqual({ m: 'a6', e: -700 }) // branche Bb5 : arrêt décisif
    expect(e5node.c[1].c[0]).toEqual({ m: 'Nf6', e: -700 }) // branche Bc4 (racine) : arrêt décisif
    expect(e5node.c[2].c[0]).toEqual({ m: 'Nf6', e: -700 }) // branche Nc3 (racine) : arrêt décisif

    expect(header.metrics).toEqual({ lines: 4, positions: 11, avgOwnMoves: 2.75, forcedShare: 6 / 7, medianFinalEval: 700 })
  })

  test('explorateur : seuils minShare/minGames, plafond maxReplies, défense et étude ajoutées', async () => {
    const start = new Chess().fen()
    const posAdverse = fenAfter('e4')
    const studies = new Map([[posKey(posAdverse), new Set(['a6'])]])
    const engine = fakeEngine({
      [posKey(start)]: [{ uci: 'e2e4', score: 20 }, { uci: 'd2d4', score: 15 }, { uci: 'g1f3', score: 10 }],
      [posKey(posAdverse)]: [{ uci: 'g7g6', score: 5 }], // meilleure défense Stockfish, absente des seuils
    })
    const explorer = fakeExplorer({
      [posKey(start)]: {
        white: 700, draws: 200, black: 100,
        moves: [{ uci: 'e2e4', san: 'e4', white: 600, draws: 300, black: 100 }],
      },
      [posKey(posAdverse)]: {
        white: 400, draws: 100, black: 500,
        moves: [
          { uci: 'e7e5', san: 'e5', white: 250, draws: 150, black: 100 }, // 500 parties, 50% de part
          { uci: 'c7c5', san: 'c5', white: 100, draws: 50, black: 250 }, // 400, 40%
          { uci: 'c7c6', san: 'c6', white: 150, draws: 50, black: 50 }, // 250, 25%
          { uci: 'g8f6', san: 'Nf6', white: 100, draws: 20, black: 100 }, // 220, 22%
          { uci: 'd7d5', san: 'd5', white: 100, draws: 60, black: 50 }, // 210, 21% : coupé par maxReplies
          { uci: 'e7e6', san: 'e6', white: 20, draws: 10, black: 20 }, // 50 parties : sous minGames malgré 5% de part
        ],
      },
    })

    const { header, tree } = await generateTree({ id: 'seuils', name: 'Seuils', side: 'white', moves: [] }, {
      engine, explorer, studies, band: { id: 'debutant', ratings: [0, 1000] },
      params: { minGames: 200, minShare: 0.05, maxReplies: 4, stopGames: 50, tolerance: 70 },
    })

    expect(tree).toHaveLength(1)
    const e4node = tree[0]
    expect(e4node.m).toBe('e4')
    expect(e4node.e).toBe(20)
    expect(e4node.alt.sort()).toEqual(['Nf3', 'd4'])

    const bySan = Object.fromEntries(e4node.c.map((n) => [n.m, n]))
    expect(Object.keys(bySan).sort()).toEqual(['Nf6', 'a6', 'c5', 'c6', 'e5', 'g6'].sort())
    expect(bySan.d5).toBeUndefined() // 5e par popularité, coupé par maxReplies=4
    expect(bySan.e6).toBeUndefined() // 50 parties < minGames malgré 5% de part
    expect(bySan.e5).toMatchObject({ f: 0.5, g: 500 })
    expect(bySan.c5).toMatchObject({ f: 0.4, g: 400 })
    expect(bySan.c6).toMatchObject({ f: 0.25, g: 250 })
    expect(bySan.Nf6).toMatchObject({ f: 0.22, g: 220 })
    expect(bySan.g6.f).toBeUndefined() // ajouté comme meilleure défense Stockfish, pas de stats humaines
    expect(bySan.a6.f).toBeUndefined() // ajouté comme coup d'étude
    for (const n of e4node.c) expect(n.c).toBeUndefined() // stopGames : aucune donnée fixée plus profond

    expect(header.band).toBe('debutant')
    expect(header.ratings).toEqual([0, 1000])
    expect(explorer.calls[1].ratings).toEqual([0, 1000])
    expect(header.metrics).toEqual({ lines: 6, positions: 8, avgOwnMoves: 1, forcedShare: 0, medianFinalEval: 20 })
  })

  test('mon coup : le seuil minGames ne s\'applique pas au camp entraîné, seul minGames adverse compte', async () => {
    const start = new Chess().fen()
    const engine = fakeEngine({
      // top3 Stockfish trié meilleur d'abord : e4 (20), d4 (15), Nf3 (10), tous à moins de 70cp.
      [posKey(start)]: [{ uci: 'e2e4', score: 20 }, { uci: 'd2d4', score: 15 }, { uci: 'g1f3', score: 10 }],
    })
    const explorer = fakeExplorer({
      [posKey(start)]: {
        white: 1000, draws: 500, black: 500,
        moves: [
          { uci: 'e2e4', san: 'e4', white: 100, draws: 100, black: 1000 }, // 1200 parties, score humain 0,125
          { uci: 'd2d4', san: 'd4', white: 25, draws: 4, black: 1 }, // 30 parties (< minGames 200), score humain 0,9
        ],
      },
    })

    const { header, tree } = await generateTree({ id: 'own-minGames', name: 'Test own minGames', side: 'white', moves: [] }, {
      engine, explorer, params: { ownMovesMax: 1, minGames: 200 },
    })

    // d4 n'a que 30 parties, sous minGames (200) : la règle adverse ne s'applique pas ici, d4 reste
    // le candidat au meilleur score humain (0,9 contre 0,125 pour e4) et doit être choisi.
    expect(tree).toEqual([{ m: 'd4', e: 15, alt: ['e4', 'Nf3'] }])
    expect(header.metrics).toEqual({ lines: 1, positions: 1, avgOwnMoves: 1, forcedShare: 0, medianFinalEval: 15 })
  })

  test('arrêt stopGames dès la position de départ', async () => {
    const explorer = fakeExplorer({
      [posKey(new Chess().fen())]: { white: 5, draws: 2, black: 3, moves: [{ uci: 'e2e4', san: 'e4', white: 3, draws: 1, black: 1 }] },
    })
    const engine = fakeEngine({}) // ne doit jamais être appelé : arrêt avant tout calcul moteur

    const { header, tree } = await generateTree({ id: 'stop-games', name: 'Stop', side: 'white', moves: [] }, { engine, explorer })

    expect(tree).toEqual([])
    expect(header.metrics).toEqual({ lines: 0, positions: 1, avgOwnMoves: 0, forcedShare: 0, medianFinalEval: 0 })
    expect(engine.calls).toHaveLength(0)
  })

  test('arrêt sur position décisive (+700, hors mat)', async () => {
    const start = new Chess().fen()
    const engine = fakeEngine({ [posKey(start)]: [{ uci: 'e2e4', score: 700 }] })

    const { tree, header } = await generateTree({ id: 'decisif', name: 'Décisif', side: 'white', moves: [] }, { engine, explorer: null })

    expect(tree).toEqual([{ m: 'e4', e: 700 }])
    expect(header.metrics.lines).toBe(1)
    expect(engine.calls).toHaveLength(1) // la position suivante n'est jamais interrogée
  })

  test("un mat forcé (score > 90000) n'est jamais coupé par la règle des +600", async () => {
    const start = new Chess().fen()
    const posAdverse = fenAfter('e4')
    const posA = fenAfter('e4', 'e5')
    const posB = fenAfter('e4', 'c5')
    const posC = fenAfter('e4', 'e6')
    const engine = fakeEngine({
      [posKey(start)]: [{ uci: 'e2e4', score: 95000 }],
      [posKey(posAdverse)]: [{ uci: 'e7e5', score: 10 }, { uci: 'c7c5', score: 5 }, { uci: 'e7e6', score: 0 }],
      [posKey(posA)]: [{ uci: 'g1f3', score: 0 }],
      [posKey(posB)]: [{ uci: 'g1f3', score: 0 }],
      [posKey(posC)]: [{ uci: 'd2d4', score: 0 }],
    })

    const { tree, header } = await generateTree({ id: 'mat', name: 'Mat', side: 'white', moves: [] }, { engine, explorer: null, params: { ownMovesMax: 2 } })

    expect(tree[0].m).toBe('e4')
    expect(tree[0].e).toBe(95000)
    expect(tree[0].c.map((n) => n.m)).toEqual(['e5', 'c5', 'e6']) // la génération continue malgré le score énorme
    for (const n of tree[0].c) expect(n.c).toHaveLength(1)
    expect(header.metrics.lines).toBe(3)
    expect(header.metrics.positions).toBe(5)
  })

  test('signal déjà annulé : rejet immédiat, aucun appel moteur', async () => {
    const controller = new AbortController()
    controller.abort()
    const engine = { analyse: () => { throw new Error('ne doit pas être appelé') } }

    let error
    try {
      await generateTree({ id: 'abort1', name: 'Abort', side: 'white', moves: [] }, { engine, explorer: null, signal: controller.signal })
    } catch (e) { error = e }
    expect(error?.name).toBe('AbortError')
  })

  test('signal annulé en cours de génération : arrêt au prochain point de contrôle', async () => {
    const controller = new AbortController()
    let calls = 0
    const engine = {
      async analyse() {
        calls++
        if (calls === 1) { controller.abort(); return [{ uci: 'e2e4', score: 20 }] }
        throw new Error('ne doit plus être appelé après abort')
      },
    }
    let error
    try {
      await generateTree({ id: 'abort2', name: 'Abort2', side: 'white', moves: [] }, { engine, explorer: null, signal: controller.signal })
    } catch (e) { error = e }
    expect(error?.name).toBe('AbortError')
    expect(calls).toBe(1)
  })

  test('onProgress reçoit positions et lines croissants', async () => {
    const start = new Chess().fen()
    const engine = fakeEngine({ [posKey(start)]: [{ uci: 'e2e4', score: 700 }] })
    const progress = []

    const { header } = await generateTree({ id: 'progress', name: 'Progress', side: 'white', moves: [] }, {
      engine, explorer: null, onProgress: (p) => progress.push({ ...p }),
    })

    expect(progress.length).toBeGreaterThan(0)
    const last = progress.at(-1)
    expect(last).toEqual({ positions: header.metrics.positions, lines: header.metrics.lines })
  })
})
