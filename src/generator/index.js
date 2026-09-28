// Générateur d'arbre d'ouverture, pur : aucun import Node ou Bun, tourne aussi dans le webview
// Tauri. Combine un moteur UCI, l'explorateur Lichess et des études communautaires pour produire
// l'arbre au format 14.3. Règles : docs/reference/contrats.md sections 5 et 14.5.
import { Chess } from 'chess.js'

export const DEFAULT_PARAMS = {
  ownMovesMax: 12,
  minShare: 0.05,
  minGames: 200,
  stopGames: 50,
  maxReplies: 4,
  tolerance: 70,
  movetime: 800,
  depth: 16,
  maxLines: 150,
}

const APP_REPLY_TOLERANCE = 120 // sans explorateur : marge des réponses adverses, en centipions
const DECISIVE_EVAL = 600 // centipions en faveur de mon camp, hors mat : on arrête la théorie
const MATE_THRESHOLD = 90000 // |score| au delà : mat forcé, encodage du 14.1
const FORCED_GAP = 100 // centipions perdus par le 2e meilleur coup pour compter "forcé"

// FEN sans les compteurs de coups, pour que les transpositions partagent une entrée de cache.
const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ')

function abortError() {
  const err = new Error('Génération annulée')
  err.name = 'AbortError'
  return err
}
function checkAbort(signal) {
  if (signal && signal.aborted) throw abortError()
}

function isLegalSan(fen, san) {
  try {
    new Chess(fen).move(san)
    return true
  } catch {
    return false
  }
}
function sanToUci(fen, san) {
  const m = new Chess(fen).move(san)
  return m.from + m.to + (m.promotion || '')
}
function uciToSan(fen, uci) {
  const c = new Chess(fen)
  return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * generateTree(opening, options) -> { header, tree }
 * opening = { id, name, side, moves } ; side = camp de l'entraînement ('white' | 'black').
 * options.engine = contrat analyse() du 14.1 (obligatoire).
 * options.explorer = null ou contrat query() du 14.1 (mode app = null).
 * options.studies = null ou Map<fenKey, Set<SAN>>.
 * options.band = null ou { id, ratings } (ratings transmis à l'explorateur, id recopié dans le header).
 * options.params = surcharge des DEFAULT_PARAMS, plus un label optionnel `engine`.
 */
export async function generateTree(opening, options = {}) {
  const { engine, explorer = null, studies = null, band = null, params = {}, onProgress = null, signal = null } = options
  if (!engine) throw new Error('generateTree: engine requis')
  if (!opening || !opening.side || !opening.moves) throw new Error('generateTree: opening invalide')

  const side = opening.side
  const { engine: engineLabel = 'stockfish', ...paramsOverride } = params
  const P = { ...DEFAULT_PARAMS, ...paramsOverride }
  const ratings = band && band.ratings ? band.ratings : null
  const prefix = opening.moves

  let positions = 0
  let lines = 0
  let ownMovesSum = 0
  let forcedCount = 0
  let forcedTotal = 0
  const finalEvals = []

  const toMySide = (whiteScore) => (side === 'white' ? whiteScore : -whiteScore)
  const report = () => { if (onProgress) onProgress({ positions, lines }) }
  const leaf = (ownMovesPlayed, myLastEval) => {
    lines++
    ownMovesSum += ownMovesPlayed
    if (myLastEval !== undefined) finalEvals.push(toMySide(myLastEval))
    report()
  }

  async function engineTop(fen, multipv) {
    checkAbort(signal)
    const res = await engine.analyse(fen, { multipv, depth: P.depth, movetime: P.movetime, signal })
    checkAbort(signal)
    return res
  }
  async function engineOne(fen, uci) {
    const res = await engine.analyse(fen, { multipv: 1, depth: P.depth, movetime: P.movetime, searchmoves: [uci], signal })
    checkAbort(signal)
    return res[0]
  }
  async function scoreOf(fen, uci, top) {
    const hit = top.find((t) => t.uci === uci)
    if (hit) return hit.score
    const res = await engineOne(fen, uci)
    return res ? res.score : undefined
  }

  // Coup de mon camp : candidats = explorateur (score humain, sans seuil de parties : la section 5
  // ne pose ce seuil que pour les coups adverses) + études + 3 meilleurs coups Stockfish ; choix =
  // meilleur score humain à moins de tolerance du meilleur coup Stockfish, repli sur ce dernier ;
  // les autres coups acceptables (même critère de tolérance) vont dans alt.
  async function myMoveNode(fen, exp) {
    const chess = new Chess(fen)
    const whiteToMove = chess.turn() === 'w'
    const top = await engineTop(fen, 3)
    forcedTotal++
    const gap = top.length < 2 ? Infinity : whiteToMove ? top[0].score - top[1].score : top[1].score - top[0].score
    if (gap > FORCED_GAP) forcedCount++

    const best = top[0]
    const within = (score) => (whiteToMove ? score >= best.score - P.tolerance : score <= best.score + P.tolerance)

    const bySan = new Map()
    for (const t of top) bySan.set(uciToSan(fen, t.uci), t.score)

    const human = []
    if (exp) {
      for (const mv of exp.moves || []) {
        const games = mv.white + mv.draws + mv.black
        if (!games) continue // aucune partie : pas de score humain calculable
        let score = bySan.get(mv.san)
        if (score === undefined) {
          score = await scoreOf(fen, mv.uci, top)
          bySan.set(mv.san, score)
        }
        if (score === undefined || !within(score)) continue
        const h = side === 'white' ? (mv.white + mv.draws / 2) / games : (mv.black + mv.draws / 2) / games
        human.push({ san: mv.san, score, human: h })
      }
    }

    const studyMoves = studies ? [...(studies.get(fenKey(fen)) || [])] : []
    for (const san of studyMoves) {
      if (bySan.has(san) || !isLegalSan(fen, san)) continue
      bySan.set(san, await scoreOf(fen, sanToUci(fen, san), top))
    }

    const pick = human.length ? human.reduce((a, b) => (b.human > a.human ? b : a)) : { san: uciToSan(fen, best.uci), score: best.score }

    const alt = new Set()
    for (const [san, score] of bySan) {
      if (score !== undefined && san !== pick.san && within(score)) alt.add(san)
    }

    const node = { m: pick.san, e: pick.score }
    if (alt.size) node.alt = [...alt]
    return node
  }

  // Coups adverses : réponses de l'explorateur à au moins minShare de part et minGames parties
  // (jusqu'à maxReplies), plus la meilleure défense Stockfish si absente, plus les études. Sans
  // explorateur (mode app) : meilleurs coups Stockfish à moins de 120cp du meilleur (règle 14.5),
  // largeur 3/2/1 selon le rang du coup adverse depuis la fin de la ligne qui définit l'ouverture.
  async function adverseNodes(fen, exp, adverseIdx) {
    const chess = new Chess(fen)
    const whiteToMove = chess.turn() === 'w'
    const seen = new Set()
    const list = []
    const add = (san, extra) => {
      if (!san || seen.has(san) || !isLegalSan(fen, san)) return
      seen.add(san)
      list.push({ san, ...extra })
    }

    if (exp) {
      const total = exp.white + exp.draws + exp.black
      const qualifying = (exp.moves || [])
        .map((mv) => ({ san: mv.san, games: mv.white + mv.draws + mv.black }))
        .filter((mv) => mv.games >= P.minGames && total > 0 && mv.games / total >= P.minShare)
        .sort((a, b) => b.games - a.games)
        .slice(0, P.maxReplies)
      for (const mv of qualifying) add(mv.san, { f: Math.round((mv.games / total) * 1000) / 1000, g: mv.games })
      const [bestDefense] = await engineTop(fen, 1)
      add(uciToSan(fen, bestDefense.uci))
    } else {
      const width = adverseIdx === 0 ? 3 : adverseIdx === 1 ? 2 : 1
      const top = await engineTop(fen, width)
      const best = top[0].score
      const within = whiteToMove ? (s) => s >= best - APP_REPLY_TOLERANCE : (s) => s <= best + APP_REPLY_TOLERANCE
      for (const t of top) if (within(t.score)) add(uciToSan(fen, t.uci))
    }

    const studyMoves = studies ? [...(studies.get(fenKey(fen)) || [])] : []
    for (const san of studyMoves) add(san)
    return list
  }

  // ctx = { ply, ownMovesPlayed, adverseIdx, myLastEval, path } ; path pour le journal des coupes.
  async function expand(fen, ctx) {
    checkAbort(signal)
    const chess = new Chess(fen)
    if (chess.isGameOver()) return []

    // Ligne qui définit l'ouverture : imposée aux 2 camps, aucun calcul.
    if (ctx.ply < prefix.length) {
      positions++
      report()
      const san = prefix[ctx.ply]
      const node = { m: san }
      const mine = (chess.turn() === 'w') === (side === 'white')
      const next = new Chess(fen)
      next.move(san)
      const nextOwn = mine ? ctx.ownMovesPlayed + 1 : ctx.ownMovesPlayed
      const nextCtx = { ply: ctx.ply + 1, ownMovesPlayed: nextOwn, adverseIdx: 0, myLastEval: ctx.myLastEval, path: [...ctx.path, san] }
      // Le plafond ownMovesMax ne coupe jamais la ligne qui définit l'ouverture : une variante nommée
      // de 13 coups ou plus se joue en entier (elle s'arrêtait avant son dernier coup).
      if (nextOwn >= P.ownMovesMax && ctx.ply + 1 >= prefix.length) leaf(nextOwn, nextCtx.myLastEval)
      else {
        const children = await expand(next.fen(), nextCtx)
        if (children.length) node.c = children
        else leaf(nextOwn, nextCtx.myLastEval)
      }
      return [node]
    }

    if (lines >= P.maxLines) {
      console.warn(`generateTree (${opening.id}) : maxLines (${P.maxLines}) atteint, ligne coupée après ${ctx.path.join(' ')}`)
      return []
    }
    positions++

    const myTurn = (chess.turn() === 'w') === (side === 'white')
    const exp = explorer ? await explorer.query({ fen, ratings }) : null
    checkAbort(signal)
    if (exp && exp.white + exp.draws + exp.black < P.stopGames) return []

    if (myTurn) {
      const node = await myMoveNode(fen, exp)
      report()
      const next = new Chess(fen)
      next.move(node.m)
      const nextOwn = ctx.ownMovesPlayed + 1
      const decisive = Math.abs(node.e) <= MATE_THRESHOLD && toMySide(node.e) >= DECISIVE_EVAL
      // adverseIdx n'est pas remis à 0 ici : c'est le rang du PROCHAIN coup adverse depuis la fin
      // de la ligne (largeur 3/2/1 du 14.5), il continue de progresser à travers mes propres coups.
      const nextCtx = { ply: ctx.ply + 1, ownMovesPlayed: nextOwn, adverseIdx: ctx.adverseIdx, myLastEval: node.e, path: [...ctx.path, node.m] }
      if (decisive || nextOwn >= P.ownMovesMax) leaf(nextOwn, node.e)
      else {
        const children = await expand(next.fen(), nextCtx)
        if (children.length) node.c = children
        else leaf(nextOwn, node.e)
      }
      return [node]
    }

    const candidates = await adverseNodes(fen, exp, ctx.adverseIdx)
    report()
    const out = []
    for (const cand of candidates) {
      checkAbort(signal)
      const node = { m: cand.san }
      if (cand.f !== undefined) node.f = cand.f
      if (cand.g !== undefined) node.g = cand.g
      const next = new Chess(fen)
      next.move(cand.san)
      const nextCtx = { ply: ctx.ply + 1, ownMovesPlayed: ctx.ownMovesPlayed, adverseIdx: ctx.adverseIdx + 1, myLastEval: ctx.myLastEval, path: [...ctx.path, cand.san] }
      const children = await expand(next.fen(), nextCtx)
      if (children.length) node.c = children
      else leaf(ctx.ownMovesPlayed, ctx.myLastEval)
      out.push(node)
    }
    return out
  }

  const tree = await expand(new Chess().fen(), { ply: 0, ownMovesPlayed: 0, adverseIdx: 0, myLastEval: undefined, path: [] })

  const header = {
    id: opening.id,
    name: opening.name,
    side,
    band: band && band.id !== undefined ? band.id : null,
    ratings,
    generatedAt: new Date().toISOString(),
    engine: engineLabel,
    params: P,
    metrics: {
      lines,
      positions,
      avgOwnMoves: lines ? ownMovesSum / lines : 0,
      forcedShare: forcedTotal ? forcedCount / forcedTotal : 0,
      medianFinalEval: median(finalEvals),
    },
  }
  return { header, tree }
}
