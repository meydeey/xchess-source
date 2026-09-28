// Cote d'entraînement interne. Les résultats sont rejoués depuis le journal, sans modifier l'Elo
// déclaré par le joueur. Les répétitions d'une même position servent la mémoire, pas la cote.
import { selectPuzzle } from './puzzles.js'

const CATEGORIES = ['attack', 'tactics', 'defense', 'technique']
const SCALE = 173.7178
const TAU = 0.5
const START = { rating: 1000, rd: 350, volatility: 0.06, count: 0 }
const BASE_WEIGHTS = { attack: 40, tactics: 25, defense: 20, technique: 15 }
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// Un puzzle est l'adversaire Glicko-2, avec une déviation fixe modérée. Cette cote reste une
// estimation pédagogique, indépendante des cotes officielles de partie et de l'XP.
export function glickoPuzzleResult(player, puzzleRating, won) {
  const mu = (player.rating - 1500) / SCALE
  const phi = player.rd / SCALE
  const sigma = player.volatility
  const opponentMu = (puzzleRating - 1500) / SCALE
  const opponentPhi = 80 / SCALE
  const g = 1 / Math.sqrt(1 + 3 * opponentPhi ** 2 / Math.PI ** 2)
  const expected = 1 / (1 + Math.exp(-g * (mu - opponentMu)))
  const variance = 1 / (g ** 2 * expected * (1 - expected))
  const delta = variance * g * ((won ? 1 : 0) - expected)
  const a = Math.log(sigma ** 2)
  const f = (x) => {
    const e = Math.exp(x)
    const p = phi ** 2 + variance + e
    return e * (delta ** 2 - phi ** 2 - variance - e) / (2 * p ** 2) - (x - a) / TAU ** 2
  }
  let A = a
  let B
  if (delta ** 2 > phi ** 2 + variance) B = Math.log(delta ** 2 - phi ** 2 - variance)
  else {
    let k = 1
    while (f(a - k * TAU) < 0 && k < 100) k++
    B = a - k * TAU
  }
  let fA = f(A)
  let fB = f(B)
  for (let i = 0; i < 100 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + (A - B) * fA / (fB - fA)
    const fC = f(C)
    if (fC * fB <= 0) { A = B; fA = fB } else fA /= 2
    B = C
    fB = fC
  }
  const nextSigma = Math.exp(A / 2)
  const phiStar = Math.sqrt(phi ** 2 + nextSigma ** 2)
  const nextPhi = 1 / Math.sqrt(1 / phiStar ** 2 + 1 / variance)
  const nextMu = mu + nextPhi ** 2 * g * ((won ? 1 : 0) - expected)
  return { rating: clamp(nextMu * SCALE + 1500, 400, 2799), rd: clamp(nextPhi * SCALE, 30, 350), volatility: nextSigma, count: (player.count || 0) + 1 }
}

function orderedAttempts(attempts) {
  return [...attempts].filter((entry) => entry?.ref).sort((a, b) => (a.at || 0) - (b.at || 0) || String(a.id || '').localeCompare(String(b.id || '')))
}

export function derivePuzzleTraining(attempts = []) {
  const result = Object.fromEntries(CATEGORIES.map((cat) => [cat, { ...START }]))
  const seen = new Set()
  for (const attempt of orderedAttempts(attempts)) {
    if (!result[attempt.cat] || seen.has(attempt.ref)) continue
    seen.add(attempt.ref)
    if (attempt.aided || !Number.isFinite(attempt.rating)) continue
    const won = attempt.result === 'solved' && !(attempt.errors > 0)
    result[attempt.cat] = glickoPuzzleResult(result[attempt.cat], attempt.rating, won)
  }
  return result
}

export function trainingTarget(category, elo = 400, source = 'chesscom') {
  if (!category || category.count < 10) return clamp(Math.round((Number(elo) || 400) + (source === 'lichess' ? 150 : 400)), 600, 2799)
  return clamp(Math.round(category.rating - 190), 400, 2799)
}

export function needsPuzzleGuidance(category, elo = 400, source = 'chesscom') {
  if (!category || category.count < 10) return (Number(elo) || 400) < (source === 'lichess' ? 1350 : 1200)
  return category.rating < 1100
}

function dueRetry(puzzles, attempts, recent) {
  const sorted = orderedAttempts(attempts)
  const latest = new Map()
  sorted.forEach((attempt, index) => latest.set(attempt.ref, { attempt, index }))
  const byId = new Map(puzzles.map((item) => [item.id, item]))
  return [...latest.values()]
    .filter(({ attempt, index }) =>
      (attempt.result !== 'solved' || attempt.errors > 0) && sorted.length - index - 1 >= 3 && !recent.includes(attempt.ref) && byId.has(attempt.ref))
    .sort((a, b) => a.index - b.index)
    .map(({ attempt }) => byId.get(attempt.ref))
}

export function chooseTrainingPuzzle(puzzles, {
  mode = 'mixed', theme = null, attempts = [], recent = [], turn = 0,
  elo = 400, source = 'chesscom', random = Math.random,
} = {}) {
  const training = derivePuzzleTraining(attempts)
  const pool = theme ? puzzles.filter((item) => item.themes.includes(theme)) : puzzles
  if (!pool.length) return null
  if (mode === 'mixed' && turn % 4 === 3) {
    const due = dueRetry(pool, attempts, recent)
    if (due.length) return due[0]
  }
  let category = mode === 'mate1' ? 'attack' : mode
  if (mode === 'mixed') {
    const available = CATEGORIES.filter((cat) => pool.some((item) => item.cat === cat))
    if (!available.length) return null
    if (turn % 7 === 6) category = [...available].sort((a, b) => training[a].count - training[b].count)[0]
    else {
      const weights = available.map((cat) => BASE_WEIGHTS[cat] * clamp(1000 / training[cat].rating, 0.7, 1.5))
      let draw = random() * weights.reduce((sum, weight) => sum + weight, 0)
      category = available[available.length - 1]
      for (let i = 0; i < available.length; i++) {
        draw -= weights[i]
        if (draw < 0) { category = available[i]; break }
      }
    }
  }
  const target = trainingTarget(training[category], elo, source)
  const candidatePool = mode === 'mate1' ? pool : pool.filter((item) => item.cat === category)
  const seen = new Set(attempts.map((attempt) => attempt.ref))
  const fresh = candidatePool.filter((item) => !seen.has(item.id))
  return selectPuzzle(fresh.length ? fresh : candidatePool, { mode: mode === 'mate1' ? 'mate1' : 'mixed', target, recent, turn, random })
}
