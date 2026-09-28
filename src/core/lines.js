// Transforme un arbre de répertoire (format 14.3 de la spec) en liste de lignes jouables.
// Pur : aucune dépendance à Vite ou au DOM, testable avec bun test.

// Étiquette d'un coup à l'affichage : "5.Ng5" ou "5…h6". Mot-jointeur pour ne jamais couper le coup.
export const moveLabel = (ply, san) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '…' : '.'}⁠${san}`

// side = camp entraîné ('white' ou 'black'). Les embranchements qui comptent (pour nommer et grouper
// les lignes) sont ceux de l'adversaire : les plis pairs (0, 2, 4…) sont les coups blancs, les impairs
// les coups noirs. Un embranchement propre (plusieurs coups de mon camp à une même position) n'existe
// pas dans ce format : mon coup est unique, ses alternatives valables vivent dans `alt`.
function isOpponentPly (ply, side) {
  const whiteToMove = ply % 2 === 0
  return side === 'white' ? !whiteToMove : whiteToMove
}

function makeLine (moves, alts, evals, branchPoints) {
  const name = branchPoints.length ? branchPoints.join('  ') : 'Variante principale'
  const group = branchPoints[0] ?? 'Variante principale'
  return { id: moves.join(' '), moves, alts, evals, name, group }
}

// linesFromTree(tree, side, { definingPly }) : parcourt l'arbre en profondeur, une ligne par feuille.
// definingPly (0 par défaut) : les plis avant cette valeur font partie du tronc qui définit l'ouverture
// et ne comptent jamais comme embranchement, même s'ils portaient plusieurs enfants. Le nom d'une ligne
// liste tous les embranchements adverses rencontrés à partir de definingPly ; le groupe retient le
// premier d'entre eux (« le premier embranchement adverse après la ligne qui définit l'ouverture »).
export function linesFromTree (tree, side, { definingPly = 0 } = {}) {
  const out = []
  ;(function walk (nodes, moves, alts, evals, branchPoints) {
    for (const n of nodes) {
      const ply = moves.length
      const branch = nodes.length > 1 && ply >= definingPly && isOpponentPly(ply, side)
      const nextBranchPoints = branch ? [...branchPoints, moveLabel(ply, n.m)] : branchPoints
      const nextMoves = moves.concat(n.m)
      const nextAlts = alts.concat([n.alt || []])
      const nextEvals = evals.concat(n.e ?? null)
      if (n.c && n.c.length) walk(n.c, nextMoves, nextAlts, nextEvals, nextBranchPoints)
      else out.push(makeLine(nextMoves, nextAlts, nextEvals, nextBranchPoints))
    }
  })(tree, [], [], [], [])
  return out
}

// lineEnding({ evals, moves, side, checkmate }) : verdict de fin de ligne (spec V2, L0 point 2).
// checkmate = la position finale est réellement mat (chess.isCheckmate(), calculé par l'appelant).
// Une éval de mat (|e| > 90000, mat encodé ±(100000 − 100 × N), N = coups du camp au trait AVANT mon
// coup, ce coup compris) sans mat sur l'échiquier devient « Mat en N » : N diminué de mon coup évalué
// et de mes coups joués depuis. Rend { kind: 'checkmate' } | { kind: 'mate', mateIn, forMe, eval }
// | { kind: 'eval', eval, winning } ; eval en centipions côté Blancs, null si la ligne n'en porte aucun.
export function lineEnding ({ evals, moves, side, checkmate }) {
  if (checkmate) return { kind: 'checkmate' }
  const k = evals.findLastIndex((e) => e != null)
  const e = k < 0 ? null : evals[k]
  const forMe = e != null && (side === 'white' ? e > 0 : e < 0)
  if (e != null && Math.abs(e) > 90000) {
    const n = Math.round((100000 - Math.abs(e)) / 100)
    let mineAfter = 0
    for (let ply = k + 1; ply < moves.length; ply++) if (!isOpponentPly(ply, side)) mineAfter++
    return { kind: 'mate', mateIn: Math.max(1, n - 1 - mineAfter), forMe, eval: e }
  }
  return { kind: 'eval', eval: e, winning: e != null && forMe && Math.abs(e) >= 300 }
}
