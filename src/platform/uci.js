// Analyse pure des lignes UCI émises par Stockfish : aucune I/O, aucun process. Mêmes
// conventions que tools/lib/uci-engine.mjs (score en centipions du point de vue des Blancs,
// mat encodé +/-(100000 - 100 x demi-coups)), pour que src/platform/tauri.js n'ait qu'à
// brancher un vrai flux de lignes dessus. Testé par tests/uci.test.js.

// Une ligne "info ... multipv N ... score cp X|score mate N ... pv UCI ..." -> { multipv, uci,
// score, mate } ou null si la ligne n'a pas de coup exploitable (pas de "pv", ou juste une
// borne alpha/bêta signalée par "bound").
export function parseInfo(line, whiteToMove) {
  if (!line.startsWith('info') || !line.includes(' pv ') || line.includes('bound')) return null
  const cp = line.match(/ score cp (-?\d+)/)
  const mate = line.match(/ score mate (-?\d+)/)
  if (!cp && !mate) return null
  const uci = line.match(/ pv (\S+)/)?.[1]
  if (!uci) return null
  const multipv = Number(line.match(/ multipv (\d+)/)?.[1] || 1)
  let score = cp ? Number(cp[1]) : Math.sign(Number(mate[1])) * (100000 - Math.abs(Number(mate[1])) * 100)
  if (!whiteToMove) score = -score
  const mateForWhite = mate ? Number(mate[1]) * (whiteToMove ? 1 : -1) : null
  return { multipv, uci, score, mate: mateForWhite }
}

// "bestmove UCI [ponder UCI]" -> { uci, ponder } ou null si la ligne n'est pas un bestmove.
export function parseBestMove(line) {
  const m = line.match(/^bestmove (\S+)(?: ponder (\S+))?/)
  return m ? { uci: m[1], ponder: m[2] || null } : null
}

// Accumule les lignes "info" d'une recherche MultiPV en un résultat trié, meilleur coup
// d'abord : même forme que analyse() de tools/lib/uci-engine.mjs, [{ uci, score, mate }].
export function createMultiPv(fen) {
  const whiteToMove = fen.split(' ')[1] === 'w'
  const byIndex = new Map()
  return {
    feed(line) {
      const info = parseInfo(line, whiteToMove)
      if (info) byIndex.set(info.multipv, { uci: info.uci, score: info.score, mate: info.mate })
    },
    lines() {
      return [...byIndex.keys()].sort((a, b) => a - b).map((k) => byIndex.get(k))
    },
  }
}
