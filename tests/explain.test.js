// Tests du module d'explications (src/explain/index.js), moteur et explorateur factices et
// déterministes : aucun accès réseau, aucun vrai Stockfish. Positions réelles produites par chess.js
// pour que les FEN utilisées comme clés de fixtures soient toujours valides. Vérifie les faits
// calculés (14.1/15.2) ET le français produit (genre des pièces, accords, pas de « le dame »).
import { describe, test, expect } from 'bun:test'
import { Chess } from 'chess.js'
import { explainTree } from '../src/explain/index.js'

const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ')

// byPos : { [posKey]: [{ uci, score, mate? }, ...] }. Position absente : renvoie [] (pas d'entrée
// forcée pour chaque position touchée, contrairement à generator.test.js : explainTree dégrade en
// douceur vers des faits null quand le moteur ne répond rien, ce que plusieurs tests exploitent).
function fakeEngine(byPos = {}) {
  const calls = []
  return {
    calls,
    async analyse(fen, opts) {
      calls.push({ fen, ...opts })
      let list = byPos[posKey(fen)] || []
      if (opts.searchmoves && opts.searchmoves.length) list = list.filter((m) => opts.searchmoves.includes(m.uci))
      return list.slice(0, opts.multipv || 1).map((m) => ({ uci: m.uci, score: m.score, mate: m.mate ?? null }))
    },
  }
}

// byPos : { [posKey]: { white, draws, black, moves: [{ san, white, draws, black }] } }.
function fakeExplorer(byPos = {}) {
  return {
    async query({ fen }) {
      return byPos[posKey(fen)] || { white: 0, draws: 0, black: 0, moves: [] }
    },
  }
}

// Construit un arbre à une seule ligne (chaque coup n'a qu'un enfant) à partir d'une suite de SAN.
function chain(...sans) {
  let root = null
  let cursor = null
  for (const san of sans) {
    const node = { m: san }
    if (!root) root = node
    else cursor.c = [node]
    cursor = node
  }
  return [root]
}

function fenAfter(...sans) {
  const c = new Chess()
  let fen = c.fen()
  for (const s of sans) fen = c.move(s).after
  return fen
}

describe('explainTree', () => {
  test('prise : un pion en prend un autre', async () => {
    const tree = chain('e4', 'd5', 'exd5')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes['e4 d5 exd5']
    expect(n.kind).toBe('own')
    expect(n.tags).toContain('capture')
    expect(n.idea).toBe('Le pion prend le pion d5.')
  })

  test('échec sans prise ni mat', async () => {
    const tree = chain('e4', 'f6', 'Qh5')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes['e4 f6 Qh5+']
    expect(n).toBeDefined()
    expect(n.tags).toContain('check')
    expect(n.tags).not.toContain('mate')
    expect(n.idea).toBe('La dame va en h5 et fait échec et attaque aussi le pion h7.')
  })

  test('mat', async () => {
    const tree = chain('f3', 'e5', 'g4', 'Qh4')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'black', definingMoves: [] }, { engine })
    const n = nodes['f3 e5 g4 Qh4#']
    expect(n.tags).toContain('mate')
    expect(n.tags).not.toContain('check')
    expect(n.idea).toBe('La dame va en h4 et fait échec et mat.')
    expect(n.eval).toBe('Mat : les Noirs gagnent immédiatement.')
  })

  test('roque côté roi', async () => {
    const tree = chain('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes['e4 e5 Nf3 Nc6 Bc4 Bc5 O-O']
    expect(n.tags).toContain('castle')
    expect(n.idea).toBe('Le roi roque côté roi.')
  })

  test('promotion avec prise', async () => {
    const sans = ['a4', 'b5', 'axb5', 'a6', 'b6', 'e5', 'bxc7', 'a5', 'cxb8=Q']
    const tree = chain(...sans)
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes[sans.join(' ')]
    expect(n.tags).toEqual(expect.arrayContaining(['capture', 'fork']))
    // La dame arrivée en b8 attaque aussi, au passage, la tour a8 (non défendue) et le pion e5
    // (non défendu) : une vraie fourchette calculée en prime, pas seulement la promotion.
    expect(n.idea).toBe('Le pion prend le cavalier b8 et se promeut en dame et attaque à la fois la tour a8 et le pion e5.')
  })

  test('sacrifice et fourchette réelle : 6.Nxf7 de l\'Alien Gambit (roi, dame, tour)', async () => {
    const sans = ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Ng5', 'h6', 'Nxf7']
    const tree = chain(...sans)
    const afterNxf7 = fenAfter(...sans)
    const engine = fakeEngine({
      [posKey(afterNxf7)]: [{ uci: 'e8f7', score: -320 }], // meilleure réponse : le roi reprend
    })
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: sans, id: 'alien-gambit' }, { engine })
    const n = nodes[sans.join(' ')]
    expect(n.kind).toBe('own')
    expect(n.tags).toEqual(expect.arrayContaining(['capture', 'sacrifice', 'fork']))
    expect(n.idea).toBe('Sacrifice du cavalier : il prend le pion f7 et attaque à la fois la dame d8 et la tour h8.')
    expect(n.details).toContain('Les Noirs doivent reprendre, leur roi se retrouve exposé et perd le droit de roquer.')
    expect(n.eval).toBe('−3,2 pour les Blancs : avantage décisif objectif des Noirs selon Stockfish.')
    // Faits imposés (definingMoves) : aucune notion de choix pour ce coup.
    expect(n.details.some((d) => d.includes('meilleure défense'))).toBe(false)
    expect(n.details.some((d) => d.includes('erreur'))).toBe(false)
  })

  test('pas de sacrifice quand le mat était déjà forcé avant le coup, quel que soit le coup joué', async () => {
    // Alien Gambit, ...Qh5+ Bh6 (noirs) : après Qh5+, le moteur annonce déjà mat en 1 pour les blancs
    // (2 seuls coups légaux, Bh6 et Kg7, mènent tous deux au même mat forcé) : Bh6 perd le fou sur sa
    // propre case d'arrivée (Qxh6#), mais ce n'est pas un sacrifice choisi, l'issue était déjà scellée
    // avant ce coup (aucune alternative légale ne l'évitait). Positions et coups réels, vérifiés par
    // chess.js et Stockfish (voir revue adversariale, bug X1 #2).
    const sans = 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Ng5 h6 Nxf7 Kxf7 Nf3 Bf5 Ne5+ Kg8 Bc4+ Kh7 g4 Be4 g5 hxg5 Nf7 Qd7 Nxg5+ Kg6 Bf7+ Kh6 Nxe4+ Kh7 Nxf6+ gxf6 Qh5+'.split(' ')
    const tree = chain(...sans, 'Bh6')
    const fenBeforeBh6 = fenAfter(...sans)
    const fenAfterBh6 = fenAfter(...sans, 'Bh6')
    const engine = fakeEngine({
      // Position avant Bh6 (après Qh5+) : le moteur y voit déjà mat en 1 pour les blancs, quel que
      // soit le coup noir (Bh6 ou Kg7) : c'est l'éval du nœud PARENT (Qh5+) qui porte ce fait.
      [posKey(fenBeforeBh6)]: [{ uci: 'h7g7', score: 99900, mate: 1 }],
      // Position après Bh6 : Qxh6# est le meilleur (et seul) coup, capture sur la case d'arrivée h6.
      [posKey(fenAfterBh6)]: [{ uci: 'h5h6', score: 99900, mate: 1 }],
    })
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [], id: 'alien-gambit' }, { engine })
    const n = nodes[[...sans, 'Bh6'].join(' ')]
    expect(n.tags).not.toContain('sacrifice')
    expect(n.idea).not.toContain('Sacrifice')
    expect(n.idea).toBe('Le fou se développe en h6 et attaque aussi le fou c1.')
  })

  test('pas de sacrifice pour un échange : la pièce prise est aussitôt reprise (3...Nc6 du Stafford)', async () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nf6', 'Nxe5', 'Nc6']
    const tree = chain(...sans)
    const engine = fakeEngine({
      [posKey(fenAfter(...sans))]: [{ uci: 'e5c6', score: 150 }], // Nxc6, que dxc6 reprend
    })
    const { nodes } = await explainTree({ tree, side: 'black', definingMoves: [] }, { engine })
    const n = nodes[sans.join(' ')]
    expect(n.tags).not.toContain('sacrifice')
    expect(n.idea).toBe('Le cavalier se développe en c6 et attaque aussi le cavalier e5.')
  })

  test('prise en passant : la phrase nomme la case où était le pion pris', async () => {
    const tree = chain('e4', 'Nf6', 'e5', 'd5', 'exd6')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes['e4 Nf6 e5 d5 exd6']
    expect(n.tags).toContain('capture')
    expect(n.idea).toBe('Le pion prend le pion d5 en passant et attaque aussi le pion c7 et le pion e7.')
  })

  test('coups aussi jouables : accord au pluriel dès 2 coups', async () => {
    const tree = chain('e4', 'e5', 'Nf3')
    tree[0].alt = ['d4']
    tree[0].c[0].c[0].alt = ['Nc3', 'Bc4']
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    expect(nodes['e4'].details).toContain('Aussi jouable : d4.')
    expect(nodes['e4 e5 Nf3'].details).toContain('Aussi jouables : Nc3, Bc4.')
  })

  test('fausse fourchette : 2 pièces attaquées, toutes deux défendues, pas de tag fork', async () => {
    const tree = chain('e4', 'e6', 'Qh5')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes['e4 e6 Qh5']
    expect(n.tags).not.toContain('fork')
    expect(n.idea).toBe('La dame va en h5 et attaque aussi le pion f7 et le pion h7.')
    expect(n.idea).not.toContain('le dame')
    expect(n.idea).not.toContain('le tour')
  })

  test('fourchette roi + pièce non défendue : la pièce défendue voisine ne se mentionne pas comme menace', async () => {
    // Gambit Stafford, ...Qxd8+ (blancs) : la dame prend en d8, fait échec au roi e8 et attaque aussi
    // le fou c8 (défendu par la tour a8) et le pion c7 (non défendu). Le roi, filtré de l'affichage,
    // comptait pour la 2e cible qualifiante du tag fork (roi + pion non défendu) ; il ne doit pas
    // faire passer le fou c8, réellement défendu, pour une menace égale au pion c7 dans la phrase.
    const sans = 'e4 e5 Nf3 Nf6 Nxe5 Nc6 Nxc6 dxc6 Bc4 Bc5 O-O Ng4 d4 Bxd4 Be3 Bxe3 Qxd8'.split(' ')
    const tree = chain(...sans)
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'black', definingMoves: [] }, { engine })
    const n = nodes[[...sans.slice(0, -1), 'Qxd8+'].join(' ')]
    expect(n.tags).toContain('fork') // roi + pion c7 : 2 cibles qualifiantes, le tag reste correct
    expect(n.idea).toBe('La dame prend la dame d8 et fait échec et attaque aussi le pion c7.')
    expect(n.idea).not.toContain('fou c8') // pièce défendue : jamais présentée comme une menace
  })

  test('menace : coup qui, sans réponse, prendrait un pion en donnant échec', async () => {
    const tree = chain('e4', 'd6', 'Bc4')
    const afterBc4 = fenAfter('e4', 'd6', 'Bc4')
    const flipped = (() => {
      const parts = afterBc4.split(' ')
      parts[1] = 'w'
      parts[3] = '-'
      return parts.join(' ')
    })()
    const engine = fakeEngine({
      [posKey(flipped)]: [{ uci: 'c4f7', score: 400 }], // Bxf7+ si les Noirs ne réagissent pas
    })
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes['e4 d6 Bc4']
    expect(n.tags).toContain('threat')
    expect(n.details.some((d) => d.startsWith('Menace : prendre le pion f7'))).toBe(true)
  })

  test('développement : un cavalier quitte sa case de départ', async () => {
    const tree = chain('Nf3')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes.Nf3
    expect(n.tags).toContain('development')
    expect(n.idea).toBe('Le cavalier se développe en f3.')
  })

  test('centre : un pion occupe une case centrale', async () => {
    const tree = chain('e4')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    const n = nodes.e4
    expect(n.tags).toContain('center')
    expect(n.idea).toBe('Le pion occupe le centre en e4.')
  })

  test('coup adverse fréquent : fréquence et parties lues directement sur le nœud de l\'arbre', async () => {
    const tree = [{ m: 'e4', c: [{ m: 'e5', f: 0.45, g: 12000 }] }]
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: ['e4'] }, { engine })
    const n = nodes['e4 e5']
    expect(n.kind).toBe('opp')
    expect(n.tags).toContain('frequent')
    expect(n.details).toContain('Coup joué dans 45 % des parties de ta tranche (12000 parties).')
  })

  test('meilleure défense et erreur punie : 2 réponses adverses, une bonne, une qui coûte cher', async () => {
    const tree = [{
      m: 'e4',
      c: [
        { m: 'e5', c: [{ m: 'Nf3' }] }, // la meilleure défense selon le moteur : petit avantage ensuite
        { m: 'c5', c: [{ m: 'Qh5' }] }, // erreur : le même camp obtient un bien plus gros avantage
      ],
    }]
    const engine = fakeEngine({
      [posKey(fenAfter('e4'))]: [{ uci: 'e7e5', score: 30 }],
      [posKey(fenAfter('e4', 'e5', 'Nf3'))]: [{ uci: 'b8c6', score: 20 }],
      [posKey(fenAfter('e4', 'c5', 'Qh5'))]: [{ uci: 'b8c6', score: 300 }],
    })
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })

    const e5 = nodes['e4 e5']
    expect(e5.kind).toBe('opp')
    expect(e5.tags).toContain('best-defense')
    expect(e5.details).toContain(`C'est la meilleure défense selon Stockfish.`)
    expect(e5.tags).not.toContain('mistake')

    const c5 = nodes['e4 c5']
    expect(c5.tags).toContain('mistake')
    expect(c5.tags).not.toContain('best-defense')
    expect(c5.details).toContain(`C'est une erreur : Qh5 confirme un avantage plus net pour toi qu'après e5.`)
  })

  test('éval proche de zéro : aucun signe affiché quand la valeur arrondie est 0,0', async () => {
    const tree = chain('Nf3')
    const engine = fakeEngine({
      [posKey(fenAfter('Nf3'))]: [{ uci: 'b8c6', score: -4 }], // −0,04 pion : arrondit à 0,0
    })
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    expect(nodes.Nf3.eval).toBe('0,0 pour les Blancs : égalité selon Stockfish.')
  })

  test('mat en N : un coup qui ne mate pas encore, mais force le mat selon le moteur', async () => {
    const tree = chain('Nf3')
    const engine = fakeEngine({
      [posKey(fenAfter('Nf3'))]: [{ uci: 'b8c6', score: 100000 - 300, mate: 3 }],
    })
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    expect(nodes.Nf3.eval).toBe('Mat en 3 pour les Blancs selon Stockfish.')
  })

  test('score humain de mon coup, via l\'explorateur (outils seulement)', async () => {
    const tree = chain('e4')
    const engine = fakeEngine()
    const explorer = fakeExplorer({
      [posKey(new Chess().fen())]: {
        white: 550, draws: 200, black: 250,
        moves: [{ san: 'e4', white: 550, draws: 200, black: 250 }],
      },
    })
    const { nodes } = await explainTree(
      { tree, side: 'white', definingMoves: [] },
      { engine, explorer, band: { id: 'debutant', ratings: [0, 1000] } },
    )
    expect(nodes.e4.human).toBe('À ton niveau, les Blancs marquent 65 % des parties dans cette position.')
  })

  test('sans explorateur : le champ human reste null', async () => {
    const tree = chain('e4')
    const engine = fakeEngine()
    const { nodes } = await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    expect(nodes.e4.human).toBeNull()
  })

  test('header : id, side et version, generatedAt au format ISO', async () => {
    const tree = chain('e4')
    const engine = fakeEngine()
    const { header } = await explainTree({ tree, side: 'white', definingMoves: [], id: 'test-open' }, { engine })
    expect(header.id).toBe('test-open')
    expect(header.side).toBe('white')
    expect(header.version).toBe(2)
    expect(() => new Date(header.generatedAt).toISOString()).not.toThrow()
  })

  test('onProgress reçoit done croissant jusqu\'à total', async () => {
    const tree = chain('e4', 'e5', 'Nf3')
    const engine = fakeEngine()
    const progress = []
    await explainTree({ tree, side: 'white', definingMoves: [] }, { engine, onProgress: (p) => progress.push({ ...p }) })
    expect(progress.length).toBe(3)
    expect(progress.at(-1)).toEqual({ done: 3, total: 3 })
  })

  test('signal déjà annulé : rejet immédiat', async () => {
    const controller = new AbortController()
    controller.abort()
    const tree = chain('e4')
    const engine = { analyse: () => { throw new Error('ne doit pas être appelé') } }
    let error
    try {
      await explainTree({ tree, side: 'white', definingMoves: [] }, { engine, signal: controller.signal })
    } catch (e) { error = e }
    expect(error?.name).toBe('AbortError')
  })

  test('transpositions : 2 chemins vers la même position ne déclenchent qu\'1 appel moteur', async () => {
    // e4 e5 Nf3 et e4 Nc6?? n'existe pas vraiment côté ouverture, donc on construit 2 branches qui
    // convergent réellement : c3 c5 puis c4 (transposition anglaise/sicilienne) vers la même position
    // que c4 c5 tout court n'est pas trivial à garantir ; on vérifie plus simplement que la MÊME
    // position, visitée 2 fois dans l'arbre (2 lignes séparées qui rejouent le même coup depuis la
    // même position de départ), ne coûte qu'un seul appel moteur grâce au cache par position.
    const tree = [
      { m: 'Nf3', c: [{ m: 'd5' }] },
      { m: 'Nf3', c: [{ m: 'd5' }] }, // même position que ci-dessus, rejouée dans une 2e branche
    ]
    const engine = fakeEngine()
    await explainTree({ tree, side: 'white', definingMoves: [] }, { engine })
    // 1 appel pour 'Nf3' (position partagée par les 2 racines) + 1 appel pour 'Nf3 d5' × 2 branches,
    // mais la 2e branche interroge exactement la même position que la 1re : le cache l'absorbe.
    const uniquePositions = new Set(engine.calls.map((c) => posKey(c.fen)))
    expect(engine.calls.length).toBe(uniquePositions.size)
  })
})
