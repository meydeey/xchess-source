// Explications des coups d'un arbre d'ouverture, pur : aucun import Node, Bun ou DOM, tourne aussi
// dans le webview Tauri. Combine chess.js (règles, matériel, attaques) et un moteur UCI (contrat
// analyse() du 14.1) pour produire le format 15.2, à partir des seuls faits calculés du 15.2 :
// aucune idée stratégique n'est inventée. Règles : docs/reference/contrats.md, 15.2 et 15.3.
import { Chess } from 'chess.js'

const PIECES = {
  p: { name: 'pion', fem: false },
  n: { name: 'cavalier', fem: false },
  b: { name: 'fou', fem: false },
  r: { name: 'tour', fem: true },
  q: { name: 'dame', fem: true },
  k: { name: 'roi', fem: false },
}
const MATERIAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const CENTER_SQUARES = new Set(['d4', 'd5', 'e4', 'e5'])
// Cases de départ des pièces mineures : quitter cette case, pour la 1re fois dans une ligne
// d'ouverture courte, vaut développement (14.5 : les lignes s'arrêtent avant le milieu de partie,
// un retour sur la case de départ n'y a pas sa place).
const MINOR_HOME_SQUARES = {
  n: new Set(['b1', 'g1', 'b8', 'g8']),
  b: new Set(['c1', 'f1', 'c8', 'f8']),
}

const EVAL_DEPTH = 12
const EVAL_MOVETIME = 300
const MISTAKE_THRESHOLD = 150 // centipions (15.2)
const SACRIFICE_THRESHOLD = 2 // points de matériel (15.2)

const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ')

function abortError() {
  const err = new Error('Explication annulée')
  err.name = 'AbortError'
  return err
}
function checkAbort(signal) {
  if (signal && signal.aborted) throw abortError()
}

// ---------- petites aides de français (genre, articles, jonctions) ----------
function pieceInfo(type) {
  return PIECES[type] || { name: 'pièce', fem: false }
}
function article(type, { indef = false } = {}) {
  const fem = pieceInfo(type).fem
  return indef ? (fem ? 'une' : 'un') : (fem ? 'la' : 'le')
}
function pieceClause(type, square) {
  return `${article(type)} ${pieceInfo(type).name} ${square}`
}
// Case où se trouvait la pièce prise : la case d'arrivée, sauf en prise en passant, où le pion pris
// est sur la colonne d'arrivée et la rangée de départ (exd6 e.p. prend le pion d5).
function capturedSquareOf(mv) {
  return mv.isEnPassant() ? mv.to[0] + mv.from[1] : mv.to
}
function sideLabel(color) {
  return color === 'w' ? 'Blancs' : 'Noirs'
}
function otherColor(color) {
  return color === 'w' ? 'b' : 'w'
}
function joinFr(list) {
  if (list.length === 0) return ''
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} et ${list[1]}`
  return `${list.slice(0, -1).join(', ')} et ${list[list.length - 1]}`
}
function formatPawns(cp) {
  const p = (Math.abs(cp) / 100).toFixed(1).replace('.', ',')
  if (p === '0,0') return '0,0' // valeur arrondie à zéro : aucun signe n'a de sens visuel ici
  if (cp > 0) return `+${p}`
  return `−${p}` // signe moins (U+2212), jamais un tiret cadratin
}

// ---------- échiquier : matériel et attaques (14.1 chess.js, sans dépendance au trait) ----------
function materialBalance(fen, color) {
  const board = new Chess(fen).board()
  let mine = 0
  let theirs = 0
  for (const row of board) {
    for (const sq of row) {
      if (!sq) continue
      if (sq.color === color) mine += MATERIAL[sq.type]
      else theirs += MATERIAL[sq.type]
    }
  }
  return mine - theirs
}

// Pièces adverses que la pièce arrivée en `destSquare` attaque, avec leur qualification de
// fourchette (15.2 : roi, dame, tour, ou pièce non défendue). chess.attackers(square, color) liste
// les cases de `color` qui attaquent `square`, sans dépendre du trait : utilisable après le coup.
function attackedTargets(chessAfter, moverColor, destSquare) {
  const oppColor = otherColor(moverColor)
  const out = []
  for (const row of chessAfter.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== oppColor) continue
      const attackers = chessAfter.attackers(sq.square, moverColor)
      if (!attackers.includes(destSquare)) continue
      const defenders = chessAfter.attackers(sq.square, oppColor)
      const qualifies = sq.type === 'k' || sq.type === 'q' || sq.type === 'r' || defenders.length === 0
      out.push({ square: sq.square, type: sq.type, qualifies })
    }
  }
  return out
}

// ---------- phrases ----------
function describeMove(f) {
  const P = pieceInfo(f.pieceType)
  let verb
  if (f.castleSide === 'k') verb = 'roque côté roi'
  else if (f.castleSide === 'q') verb = 'roque côté dame'
  else if (f.isPromotion) {
    const promo = pieceInfo(f.promotionType)
    verb = f.isCapture
      ? `prend ${pieceClause(f.capturedType, f.to)} et se promeut en ${promo.name}`
      : `se promeut en ${promo.name} en ${f.to}`
  } else if (f.isCapture) verb = `prend ${pieceClause(f.capturedType, f.capturedSquare)}${f.isEnPassant ? ' en passant' : ''}`
  else if (f.isCenter) verb = `occupe le centre en ${f.to}`
  else if (f.isDevelopment) verb = `se développe en ${f.to}`
  else verb = `va en ${f.to}`

  const subject = f.sacrifice ? (P.fem ? 'elle' : 'il') : `${P.fem ? 'La' : 'Le'} ${P.name}`
  let sentence = `${subject} ${verb}`
  if (f.isMate) sentence += ' et fait échec et mat'
  else if (f.isCheck) sentence += ' et fait échec'

  // Le roi ne se mentionne jamais ici : échec/mat le disent déjà. Une fois mat, la partie est finie,
  // les autres pièces attaquées n'ont plus d'intérêt (on n'en dit rien, même si le fait est calculé).
  if (!f.isMate) {
    const shown = f.targets.filter((t) => t.type !== 'k')
    const shownQualifying = shown.filter((t) => t.qualifies)
    if (shownQualifying.length >= 2) {
      sentence += ` et attaque à la fois ${joinFr(shownQualifying.map((t) => pieceClause(t.type, t.square)))}`
    } else if (shownQualifying.length === 1) {
      // 1 seule cible qualifie parmi celles montrées (le roi, exclu ci-dessus, comptait pour la 2e
      // dans le tag fork de composeDetails) : ne mentionner qu'elle, jamais une pièce défendue à côté
      // avec la même formule, qui la ferait passer à tort pour une menace équivalente.
      sentence += ` et attaque aussi ${pieceClause(shownQualifying[0].type, shownQualifying[0].square)}`
    } else if (shown.length >= 1) {
      sentence += ` et attaque aussi ${joinFr(shown.map((t) => pieceClause(t.type, t.square)))}`
    }
  }
  sentence += '.'

  if (f.sacrifice) {
    const prefix = P.fem ? `Sacrifice de la ${P.name}` : `Sacrifice du ${P.name}`
    sentence = `${prefix} : ${sentence}`
  }
  return sentence
}

function formatEvalPhrase(f) {
  if (f.isMate) return `Mat : les ${sideLabel(f.moverColor)} gagnent immédiatement.`
  if (f.evalWhite == null) return null
  // Un mat forcé encode un score à ±(100000 − 100×N) (14.1) : sa valeur en pions n'a aucun sens à
  // afficher (« −999,0 »), seul « mat en N » compte, comme pour le coup qui mate immédiatement.
  if (f.evalMate) {
    const winner = f.evalMate > 0 ? 'Blancs' : 'Noirs'
    return `Mat en ${Math.abs(f.evalMate)} pour les ${winner} selon Stockfish.`
  }
  const pawnsStr = formatPawns(f.evalWhite)
  const abs = Math.abs(f.evalWhite)
  if (abs < 50) return `${pawnsStr} pour les Blancs : égalité selon Stockfish.`
  const level = abs < 150 ? 'léger avantage' : abs < 300 ? 'net avantage' : 'avantage décisif'
  const better = f.evalWhite > 0 ? 'Blancs' : 'Noirs'
  return `${pawnsStr} pour les Blancs : ${level} objectif des ${better} selon Stockfish.`
}

function formatHumanPhrase(fraction, moverColor) {
  if (fraction == null) return null
  const pct = Math.round(fraction * 100)
  return `À ton niveau, les ${sideLabel(moverColor)} marquent ${pct} % des parties dans cette position.`
}

function composeDetails(f) {
  const details = []
  const tags = new Set()
  if (f.isCapture) tags.add('capture')
  if (f.isCheck) tags.add('check')
  if (f.isMate) tags.add('mate')
  if (f.castleSide) tags.add('castle')
  if (f.sacrifice) tags.add('sacrifice')
  const qualifyingCount = f.targets.filter((t) => t.qualifies).length
  if (f.targets.length >= 2 && qualifyingCount >= 2) tags.add('fork')
  if (f.isDevelopment) tags.add('development')
  if (f.isCenter) tags.add('center')

  if (f.sacrifice && f.bestReply && f.bestReply.to === f.to && f.bestReply.isCapture) {
    const opp = sideLabel(otherColor(f.moverColor))
    details.push(f.bestReply.pieceType === 'k'
      ? `Les ${opp} doivent reprendre, leur roi se retrouve exposé et perd le droit de roquer.`
      : `Les ${opp} doivent reprendre en ${f.to}.`)
  }

  if (f.kind === 'opp' && !f.isPrefix) {
    if (f.isBestDefense) {
      details.push(`C'est la meilleure défense selon Stockfish.`)
      tags.add('best-defense')
    } else if (f.mistake) {
      details.push(`C'est une erreur : ${f.mistake.punishingSan} confirme un avantage plus net pour toi qu'après ${f.mistake.bestDefenseSan}.`)
      tags.add('mistake')
    }
    if (f.freq !== undefined) {
      const pct = Math.round(f.freq * 100)
      details.push(`Coup joué dans ${pct} % des parties de ta tranche (${f.games} parties).`)
      tags.add('frequent')
    }
  }

  if (f.kind === 'own' && !f.isPrefix && f.alt && f.alt.length) {
    details.push(`Aussi jouable${f.alt.length > 1 ? 's' : ''} : ${f.alt.join(', ')}.`)
  }

  if (f.menace) {
    tags.add('threat')
    const clause = f.menace.isCapture ? `prendre ${pieceClause(f.menace.capturedType, f.menace.capturedSquare)}` : `jouer ${f.menace.san}`
    details.push(`Menace : ${clause} si les ${sideLabel(otherColor(f.moverColor))} ne réagissent pas.`)
  }

  return { details: details.slice(0, 3), tags: [...tags] }
}

// ---------- explainTree ----------
/**
 * explainTree({ tree, side, definingMoves, id? }, options) -> { header, nodes } (format 15.2)
 * tree = tableau de nœuds du format 14.3. side = camp entraîné ('white' | 'black'). definingMoves =
 * coups (SAN) qui définissent l'ouverture (opening.moves) : imposés aux 2 camps, sans choix réel,
 * donc sans fréquence, sans meilleure défense ni erreur (15.1).
 * options.engine = contrat analyse() du 14.1 (obligatoire). options.explorer = null ou contrat
 * query() du 14.1 (score humain de mes coups, outils seulement). options.band = null ou
 * { id, ratings } (transmis à l'explorateur). options.onProgress({ done, total }). options.signal.
 */
export async function explainTree(input, options = {}) {
  const { tree, side, definingMoves = [], id = null } = input || {}
  const { engine, explorer = null, band = null, onProgress = null, signal = null, engineLabel = 'stockfish' } = options
  if (!engine) throw new Error('explainTree: engine requis')
  if (!tree || !side) throw new Error('explainTree: tree et side requis')
  const sideColor = side === 'white' ? 'w' : 'b'

  // Cache d'évaluation par position : les transpositions entre nœuds partagent 1 seul appel moteur.
  // Les branches se visitent en parallèle (Promise.all plus bas) : la clé stocke la PROMESSE elle-
  // même, posée dans la map avant tout await, pour que 2 nœuds qui atteignent la même position au
  // même instant partagent le même appel en vol plutôt que d'interroger 2 fois le moteur.
  const evalCache = new Map()
  function analyse(fen, multipv = 1) {
    checkAbort(signal)
    const key = `${fenKey(fen)}|${multipv}`
    if (!evalCache.has(key)) {
      evalCache.set(key, (async () => {
        const res = await engine.analyse(fen, { multipv, depth: EVAL_DEPTH, movetime: EVAL_MOVETIME, signal })
        checkAbort(signal)
        return res
      })())
    }
    return evalCache.get(key)
  }

  let total = 0
  const count = (nodes) => { for (const n of nodes) { total++; if (n.c) count(n.c) } }
  count(tree)
  let done = 0
  const report = () => { if (onProgress) onProgress({ done, total }) }

  const records = []

  // Menace (15.2) : le meilleur coup Stockfish si c'était encore mon camp de jouer, par un coup nul
  // (trait inversé sur le FEN résultant, case en passant effacée puisqu'elle ne vaudrait plus).
  // Réservé à mes coups qui ne donnent pas déjà échec (le coup nul n'a alors aucun sens).
  async function computeMenace(fenAfter, moverColor) {
    const parts = fenAfter.split(' ')
    parts[1] = moverColor
    parts[3] = '-'
    const flippedFen = parts.join(' ')
    let chess
    try { chess = new Chess(flippedFen) } catch { return null }
    let top
    try { top = await analyse(flippedFen, 1) } catch { return null }
    const best = top && top[0]
    if (!best || !best.uci) return null
    let mv
    try {
      mv = chess.move({ from: best.uci.slice(0, 2), to: best.uci.slice(2, 4), promotion: best.uci[4] || undefined })
    } catch { return null }
    const isCapture = mv.isCapture() || mv.isEnPassant()
    const isCheckMove = mv.san.includes('+') || mv.san.includes('#')
    if (!isCapture && !isCheckMove) return null // menace réelle seulement : prise ou échec
    return { san: mv.san, isCapture, capturedType: mv.captured || null, capturedSquare: capturedSquareOf(mv), to: mv.to, pieceType: mv.piece }
  }

  async function computeHumanScore(fenBefore, san) {
    if (!explorer || !band) return null
    try {
      const exp = await explorer.query({ fen: fenBefore, ratings: band.ratings })
      const mv = (exp.moves || []).find((m) => m.san === san)
      if (!mv) return null
      const games = (mv.white || 0) + (mv.draws || 0) + (mv.black || 0)
      if (!games) return null
      return side === 'white' ? (mv.white + mv.draws / 2) / games : (mv.black + mv.draws / 2) / games
    } catch { return null }
  }

  // parentBestReplySan : le meilleur coup Stockfish trouvé par le nœud parent ('own') à la position
  // où l'adversaire choisit ; sert à marquer isBestDefense sur les enfants ('opp') de ce nœud.
  // parentForcedMate : mat forcé (`evalMate`, ±N) déjà annoncé par le moteur À LA POSITION `fenBefore`,
  // c'est à dire l'évaluation du nœud parent lui-même (analyse(fenAfter) du parent = analyse(fenBefore)
  // d'ici). Sa présence dit que l'issue était déjà scellée avant ce coup, quel que soit le coup joué
  // (l'évaluation moteur, à profondeur égale, tient déjà compte de la meilleure défense) : un coup qui,
  // dans ces conditions, perd du matériel n'est pas un sacrifice choisi (15.2/bug X1 #2).
  async function visitNode(node, fenBefore, depth, path, parentBestReplySan, parentForcedMate) {
    checkAbort(signal)
    const chessBefore = new Chess(fenBefore)
    const moverColor = chessBefore.turn()
    const mv = chessBefore.move(node.m)
    const fenAfter = mv.after
    const san = mv.san
    const kind = moverColor === sideColor ? 'own' : 'opp'
    const isPrefix = depth < definingMoves.length
    const newPath = [...path, san]
    const key = newPath.join(' ')

    const isMate = san.includes('#')
    const isCheck = !isMate && san.includes('+')

    const chessAfter = new Chess(fenAfter)
    const targets = attackedTargets(chessAfter, moverColor, mv.to)

    let best = null
    if (!isMate) {
      const top = await analyse(fenAfter, 1)
      best = top && top[0] ? top[0] : null
    }
    done++
    report()

    let bestReplySan = null
    let bestReply = null
    let sacrifice = false
    if (best && best.uci) {
      try {
        const chessReply = new Chess(fenAfter)
        const replyMv = chessReply.move({ from: best.uci.slice(0, 2), to: best.uci.slice(2, 4), promotion: best.uci[4] || undefined })
        bestReplySan = replyMv.san
        bestReply = { to: replyMv.to, isCapture: replyMv.isCapture() || replyMv.isEnPassant(), pieceType: replyMv.piece }
        // Sacrifice : la pièce qui vient de jouer (ou de prendre) se fait reprendre SUR SA PROPRE
        // case d'arrivée, pour un bilan négatif d'au moins 2 points. Sans cette condition, tout coup
        // calme joué dans une position déjà perdante (matériel qui continue de fondre ailleurs sur
        // l'échiquier, sans rapport avec ce coup) se ferait passer à tort pour un sacrifice.
        // Un simple échange n'en est pas un : si je peux reprendre à mon tour sur cette case, le bilan
        // se mesure après ma meilleure reprise (3...Nc6 du Stafford, Nc6 qui pare Qa4+ : la pièce
        // prise est aussitôt reprise, rien n'est sacrifié).
        if (bestReply.isCapture && bestReply.to === mv.to && parentForcedMate == null) {
          const before = materialBalance(fenBefore, moverColor)
          let after = materialBalance(replyMv.after, moverColor)
          for (const re of new Chess(replyMv.after).moves({ verbose: true })) {
            if (re.to === mv.to && re.captured) after = Math.max(after, materialBalance(re.after, moverColor))
          }
          if (after - before <= -SACRIFICE_THRESHOLD) sacrifice = true
        }
      } catch { /* coup hors contrat (moteur factice de test) : pas de sacrifice détecté */ }
    }

    let menace = null
    if (kind === 'own' && !isCheck && !isMate) menace = await computeMenace(fenAfter, moverColor)

    let human = null
    if (kind === 'own' && !isPrefix) human = await computeHumanScore(fenBefore, san)

    const facts = {
      kind, isPrefix, moverColor,
      pieceType: mv.piece, capturedType: mv.captured || null, capturedSquare: capturedSquareOf(mv), to: mv.to, from: mv.from,
      isEnPassant: mv.isEnPassant(),
      isCapture: mv.isCapture() || mv.isEnPassant(),
      isCheck, isMate,
      castleSide: mv.isKingsideCastle() ? 'k' : mv.isQueensideCastle() ? 'q' : null,
      isPromotion: mv.isPromotion(), promotionType: mv.promotion || null,
      isCenter: CENTER_SQUARES.has(mv.to),
      isDevelopment: (mv.piece === 'n' || mv.piece === 'b') && !!MINOR_HOME_SQUARES[mv.piece]?.has(mv.from),
      targets, sacrifice, bestReply,
      evalWhite: best ? best.score : null,
      evalMate: best ? best.mate : null,
      menace, human,
      freq: node.f, games: node.g,
      alt: node.alt || null,
      isBestDefense: kind === 'opp' && !isPrefix && parentBestReplySan != null && san === parentBestReplySan,
      mistake: null,
    }
    facts.evalMySide = isMate
      ? (kind === 'own' ? 100000 : -100000)
      : facts.evalMate
        ? ((facts.evalMate > 0) === (sideColor === 'w') ? 100000 : -100000)
        : (sideColor === 'w' ? facts.evalWhite : -facts.evalWhite)

    const record = { key, facts, childRecords: null }
    records.push(record)

    if (node.c && node.c.length) {
      // En parallèle (Promise.all) : les branches adverses (ou ma seule réponse) sont indépendantes,
      // et un EnginePool à plusieurs moteurs (14.1) ne sert à rien si un seul nœud à la fois attend
      // une réponse. L'ordre de record.childRecords, lui, reste celui de node.c (Promise.all le
      // préserve), ce dont dépend la détection d'erreur juste après.
      record.childRecords = await Promise.all(
        node.c.map((child) => visitNode(child, fenAfter, depth + 1, newPath, kind === 'own' ? bestReplySan : null, facts.evalMate)),
      )
      if (kind === 'own' && record.childRecords.length > 1) {
        const bestSibling = record.childRecords.find((c) => c.facts.isBestDefense)
        if (bestSibling && bestSibling.childRecords && bestSibling.childRecords.length === 1) {
          const bestFollowUp = bestSibling.childRecords[0].facts.evalMySide
          for (const sib of record.childRecords) {
            if (sib === bestSibling || !sib.childRecords || sib.childRecords.length !== 1) continue
            const followUp = sib.childRecords[0].facts.evalMySide
            if (followUp - bestFollowUp >= MISTAKE_THRESHOLD) {
              sib.facts.mistake = {
                punishingSan: sib.childRecords[0].key.split(' ').at(-1),
                bestDefenseSan: bestSibling.key.split(' ').at(-1),
              }
            }
          }
        }
      }
    }
    return record
  }

  checkAbort(signal)
  await Promise.all(tree.map((root) => visitNode(root, new Chess().fen(), 0, [], null, null)))

  const nodes = {}
  for (const record of records) {
    const { details, tags } = composeDetails(record.facts)
    nodes[record.key] = {
      kind: record.facts.kind,
      idea: describeMove(record.facts),
      details,
      eval: formatEvalPhrase(record.facts),
      human: formatHumanPhrase(record.facts.human, record.facts.moverColor),
      tags,
      facts: {
        pieceType: record.facts.pieceType, from: record.facts.from, to: record.facts.to,
        capturedType: record.facts.capturedType, castleSide: record.facts.castleSide,
        promotionType: record.facts.promotionType, evalWhite: record.facts.evalWhite,
        evalMate: record.facts.evalMate, human: record.facts.human,
        freq: record.facts.freq, games: record.facts.games,
      },
    }
  }

  return {
    header: { id, side, generatedAt: new Date().toISOString(), engine: engineLabel, version: 2 },
    nodes,
  }
}
