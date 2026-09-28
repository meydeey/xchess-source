import { Chess } from 'chess.js'

const MAX_PGN_BYTES = 10 * 1024 * 1024
const STANDARD_FEN = new Chess().fen()

export function parsePgnGames(text) {
  if (new TextEncoder().encode(text).byteLength > MAX_PGN_BYTES) throw new Error('games.fileTooLarge')
  const source = String(text).replace(/\r\n?/g, '\n').trim()
  if (!source) throw new Error('games.fileEmpty')
  const chunks = source.split(/\n\s*(?=\[Event\s+")/).filter(Boolean)
  const games = []
  const invalid = []
  for (let index = 0; index < chunks.length; index++) {
    try {
      const chess = new Chess()
      chess.loadPgn(chunks[index], { strict: false })
      const moves = chess.history({ verbose: true })
      if (!moves.length) throw new Error('No moves')
      const headers = chess.getHeaders()
      const initialFen = headers.FEN || STANDARD_FEN
      games.push({
        pgn: chunks[index], initialFen,
        white: headers.White || '', black: headers.Black || '',
        date: headers.UTCDate || headers.Date || '', time: headers.UTCTime || headers.StartTime || headers.Time || '',
        round: headers.Round || '', link: headers.Link || '', site: headers.Site || '',
        result: headers.Result || '', moves: moves.map((move) => ({ san: move.san, uci: `${move.from}${move.to}${move.promotion || ''}`, before: move.before, after: move.after, color: move.color })),
      })
    } catch { invalid.push(index + 1) }
  }
  return { games, invalid }
}

export function pgnPlayers(games) {
  const counts = new Map()
  for (const game of games) for (const name of [game.white, game.black]) if (name) counts.set(name, (counts.get(name) || 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }))
}

export function sideForPlayer(game, player) {
  const name = String(player || '').trim().toLowerCase()
  if (!name || game.white.toLowerCase() === game.black.toLowerCase()) return null
  if (game.white.toLowerCase() === name) return 'white'
  if (game.black.toLowerCase() === name) return 'black'
  return null
}

export async function gameFingerprint(game) {
  const canonical = JSON.stringify([game.initialFen, game.white.trim().toLowerCase(), game.black.trim().toLowerCase(), game.date, game.time, game.round, game.link, game.site, game.moves.map((move) => move.uci)])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const whiteChance = (score) => 1 / (1 + Math.exp(-0.00368208 * Math.max(-10000, Math.min(10000, score))))
export function winningChance(score, side) {
  const chance = whiteChance(score)
  return side === 'white' ? chance : 1 - chance
}

function sameMove(move, uci) { return move?.uci === uci }
export function topGameDecisions(decisions) {
  return [...decisions].filter((d) => d.accepted?.length)
    .sort((a, b) => Number(b.mistake) - Number(a.mistake) || b.loss - a.loss || a.ply - b.ply).slice(0, 3)
}

// Retourne jusqu'à 3 décisions rejouables. Une erreur grave est confirmée par une recherche plus
// profonde ; en son absence, une décision réellement jouée reste un exercice de transfert.
export async function analyzeGame(game, side, engine, { fromPly = 0, previous = [], onCheckpoint = async () => {}, shouldPause = () => false } = {}) {
  if (!['white', 'black'].includes(side)) throw new Error('games.sideUnknown')
  const decisions = [...previous]
  for (let ply = fromPly; ply < game.moves.length; ply++) {
    if (shouldPause()) return { complete: false, nextPly: ply, decisions }
    const move = game.moves[ply]
    if (move.color !== (side === 'white' ? 'w' : 'b') || ply < 8) continue
    const lines = await engine.analyse(move.before, { multipv: 3, depth: 10, movetime: 350 })
    if (!lines.length || !lines[0].uci) continue
    const best = lines[0]
    const played = lines.find((line) => sameMove(line, move.uci)) || (await engine.analyse(move.before, { depth: 10, movetime: 350, searchmoves: [move.uci] }))[0]
    if (!played || !Number.isFinite(best.score) || !Number.isFinite(played.score)) continue
    let loss = Math.max(0, winningChance(best.score, side) - winningChance(played.score, side))
    let accepted = lines.filter((line) => winningChance(best.score, side) - winningChance(line.score, side) <= 0.05).map((line) => line.uci)
    if (loss >= 0.2) {
      const verifiedLines = await engine.analyse(move.before, { multipv: 3, depth: 14, movetime: 750 })
      const verifiedBest = verifiedLines[0]
      const [verifiedPlayed] = await engine.analyse(move.before, { depth: 14, movetime: 750, searchmoves: [move.uci] })
      if (!verifiedBest || !verifiedPlayed) continue
      loss = Math.max(0, winningChance(verifiedBest.score, side) - winningChance(verifiedPlayed.score, side))
      accepted = verifiedLines.filter((line) => winningChance(verifiedBest.score, side) - winningChance(line.score, side) <= 0.05).map((line) => line.uci)
    }
    decisions.push({ ref: `${game.gameId}:${ply}`, gameId: game.gameId, ply, fen: move.before, played: move.uci, accepted, loss: Math.round(loss * 100), mistake: loss >= 0.2 })
    if ((ply + 1) % 10 === 0 || (ply + 2) % 10 === 0) await onCheckpoint(ply + 1, decisions)
  }
  return { complete: true, nextPly: game.moves.length, decisions: topGameDecisions(decisions) }
}
