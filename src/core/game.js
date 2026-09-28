// Jeu (spec V2, lot L10, ADR-0007) : XP, niveaux et titres, série et gels, objectif du jour, défis du
// jour, coffre, trophées, mémoire des lignes, découverte du jour et tirage du Rush. Pur : aucune
// dépendance au DOM, à Vite ou au store. L'état de jeu se dérive TOUJOURS du journal d'activité (clé
// `activity` du store), rejoué dans l'ordre (at, id) : les mêmes événements donnent le même état, quel
// que soit leur ordre d'arrivée. L'XP d'une ligne ou d'un Rush est figée dans son événement ; défis,
// trophées et série se recalculent à chaque rejeu.
import { localDateStr, DAY, INTERVALS } from './srs.js'

// ---------- hasard reproductible ----------
// hashStr : FNV-1a 32 bits. createRng : mulberry32, graine numérique ou texte (ex. 'quests:2026-09-22').
export function hashStr (s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
export function createRng (seed) {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// Clé courte d'une ligne (son id est la suite de ses coups SAN, jusqu'à 100 caractères).
export const lineKey = (lineId) => hashStr(lineId).toString(36)

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const roundTo = (x, step) => Math.round(x / step) * step

// Jour local AAAA-MM-JJ décalé de k jours (constructeur local : insensible aux changements d'heure).
export function addDays (day, k) {
  const [y, m, d] = day.split('-').map(Number)
  return localDateStr(new Date(y, m - 1, d + k).getTime())
}

// ---------- journal d'activité ----------
// Événement : { id, at, day, kind, xp, data }, sous-ensemble du format du journal de la spec V2 (§5.1).
// kind : 'line' (un passage de ligne terminé), 'rush', 'quests' (les défis du jour, figés à leur
// tirage), 'chest' (coffre ouvert, récompense figée), 'history' (reprise de la progression antérieure).
export function newEvent (kind, { at = Date.now(), xp = 0, data = {} } = {}) {
  const id = globalThis.crypto?.randomUUID?.() ?? `${at.toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return { id, at, day: localDateStr(at), kind, xp, data }
}
export function sortEvents (events) {
  return [...events].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---------- combo et XP d'une ligne ----------
// Le combo compte les coups justes du 1er coup, d'une ligne à l'autre ; une erreur ou un indice le
// remet à 0. Chaque coup juste rapporte 1 XP multiplié par le palier de combo, puis par les bonus
// actifs (coffre « XP ×2 », découverte du jour).
export const COMBO_TIERS = [[50, 3], [25, 2], [10, 1.5]]
export function comboMultiplier (combo) {
  for (const [min, mult] of COMBO_TIERS) if (combo >= min) return mult
  return 1
}
export function moveXp (combo, boost = 1) {
  return Math.round(comboMultiplier(combo) * boost)
}
export const LINE_BONUS = { fresh: 5, flawless: 5, onTime: 5, mastered: 20, checkmate: 5 }
// phase : 'new' (ligne neuve), 'due' (révision à l'échéance), 'extra' (hors échéance).
export function lineBonuses ({ phase, errors, becameMastered, checkmate }) {
  const parts = []
  if (phase === 'new') parts.push({ key: 'fresh', label: 'Nouvelle ligne', xp: LINE_BONUS.fresh })
  if (errors === 0) parts.push({ key: 'flawless', label: 'Sans faute', xp: LINE_BONUS.flawless })
  if (phase === 'due' && errors === 0) parts.push({ key: 'onTime', label: "Rappel à l'heure", xp: LINE_BONUS.onTime })
  if (becameMastered) parts.push({ key: 'mastered', label: 'Ligne maîtrisée', xp: LINE_BONUS.mastered })
  if (checkmate) parts.push({ key: 'checkmate', label: 'Échec et mat', xp: LINE_BONUS.checkmate })
  return parts
}

// ---------- niveaux et titres ----------
// XP cumulée pour atteindre le niveau n : 25 × n × (n − 1) (niveau 2 à 50, 10 à 2 250, 20 à 9 500).
export const xpForLevel = (n) => 25 * n * (n - 1)
export const TITLES = [
  [1, 'Pion'], [5, 'Cavalier'], [10, 'Fou'], [15, 'Tour'], [20, 'Dame'], [25, 'Roi'],
  [30, 'Stratège'], [35, 'Analyste'], [40, 'Architecte'], [45, 'Virtuose'],
  [50, 'Légende XChess'],
]
export function titleOf (level) {
  let title = TITLES[0][1]
  for (const [min, t] of TITLES) if (level >= min) title = t
  return title
}
export function levelOf (xp) {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level++
  const base = xpForLevel(level)
  const span = xpForLevel(level + 1) - base
  const next = TITLES.find(([min]) => min > level)
  return {
    level,
    title: titleOf(level),
    xp,
    into: xp - base,
    span,
    progress: (xp - base) / span,
    nextTitle: next ? { level: next[0], title: next[1] } : null,
  }
}

// ---------- série et gels ----------
// Un jour est actif dès qu'une ligne ou un Rush y est terminé. Un gel s'obtient tous les 7 jours de
// série (et par le coffre), 2 au plus en réserve ; un jour manqué en consomme un et la série continue.
export const FREEZE_EVERY = 7
export const FREEZE_MAX = 2
export function streakOf (activeDays, { today, grants = new Map() } = {}) {
  const days = [...activeDays, ...grants.keys()].filter((d) => d <= today).sort()
  let current = 0
  let best = 0
  let freezes = 0
  const frozen = []
  if (days.length) {
    for (let d = days[0]; d <= today; d = addDays(d, 1)) {
      freezes = Math.min(FREEZE_MAX, freezes + (grants.get(d) || 0))
      if (activeDays.has(d)) {
        current++
        best = Math.max(best, current)
        if (current % FREEZE_EVERY === 0) freezes = Math.min(FREEZE_MAX, freezes + 1)
      } else if (d === today) {
        // aujourd'hui n'est pas fini : la série tient encore
      } else if (current > 0 && freezes > 0) {
        freezes--
        frozen.push(d)
      } else current = 0
    }
  }
  const todayActive = activeDays.has(today)
  return { current, best, freezes, frozen, todayActive, atRisk: !todayActive && current > 0 }
}

// ---------- objectif du jour ----------
export const GOALS = { 30: 'Détente', 60: 'Régulier', 120: 'Sérieux', 200: 'Intense' }
export const DEFAULT_GOAL = 60

// ---------- défis du jour ----------
// Tirés 1 fois par jour (événement 'quests'), 1 facile, 1 moyen, 1 difficile. Les cibles se calent sur
// la semaine écoulée, et les choix visent ce qui fait progresser : révisions dues d'abord, camp moins
// joué, découverte du jour, combo un cran au-dessus du record récent.
export const QUEST_XP = { easy: 15, medium: 25, hard: 40 }
export function generateQuests (day, ctx = {}) {
  const {
    avgLines = 0, avgFlawless = 0, bestCombo = 0, rushBest = 0, dueCount = 0, newAvailable = 0,
    goal = DEFAULT_GOAL, weakSide = null, rushReady = false, pick = null,
    challengeFocus = null, personalDue = 0,
  } = ctx
  const rand = createRng(`quests:${day}`)
  const choose = (list) => list[Math.floor(rand() * list.length)]

  let easy
  if (dueCount > 0) easy = { kind: 'due', target: Math.min(dueCount, 5) }
  else if (newAvailable > 0) easy = { kind: 'fresh', target: Math.min(newAvailable, 3) }
  else easy = { kind: 'lines', target: clamp(Math.round(avgLines * 0.8), 2, 10) }

  const medium = [
    { kind: 'flawless', target: clamp(Math.round(avgFlawless * 0.8), 2, 8) },
    { kind: 'combo', target: clamp(roundTo(bestCombo * 0.6, 5), 5, 20) },
  ]
  if (pick) medium.push({ kind: 'pick', target: 1, openingId: pick })
  if (weakSide) medium.push({ kind: 'side', target: 2, side: weakSide })
  const mid = challengeFocus ? { kind: 'puzzles', target: challengeFocus === 'foundations' ? 2 : 4 } : choose(medium)

  const hard = [
    { kind: 'xp', target: Math.max(20, roundTo(goal * 1.5, 10)) },
    { kind: 'combo', target: clamp(roundTo(bestCombo, 5) + 5, 10, 60) },
  ]
  if (rushReady) hard.push({ kind: 'rush', target: Math.max(5, Math.round(rushBest * 0.9)) })
  const top = personalDue > 0 ? { kind: 'drills', target: 1 } : challengeFocus ? { kind: 'newPuzzle', target: 1 } : choose(hard.filter((q) => q.kind !== mid.kind))

  return [[easy, 'easy'], [mid, 'medium'], [top, 'hard']].map(([q, level]) => ({
    id: `${day}:${level}:${q.kind}`, level, xp: QUEST_XP[level], ...q,
  }))
}
const plural = (n, one, many) => (n > 1 ? many : one)
export function questLabel (q, nameOf = () => null) {
  const n = q.target
  switch (q.kind) {
    case 'due': return `Révise ${n} ${plural(n, 'ligne', 'lignes')} à l'heure`
    case 'fresh': return `Apprends ${n} ${plural(n, 'nouvelle ligne', 'nouvelles lignes')}`
    case 'lines': return `Termine ${n} lignes`
    case 'flawless': return `Réussis ${n} lignes sans faute`
    case 'combo': return `Atteins un combo de ${n}`
    case 'pick': return `Joue la découverte du jour${nameOf(q.openingId) ? ` : ${nameOf(q.openingId)}` : ''}`
    case 'side': return `Termine ${n} lignes avec les ${q.side === 'black' ? 'Noirs' : 'Blancs'}`
    case 'xp': return `Gagne ${n} XP aujourd'hui`
    case 'rush': return `Marque ${n} points au Rush`
    case 'puzzles': return `Résous ${n} exercices`
    case 'drills': return `Rejoue ${n} position de tes parties`
    case 'newPuzzle': return `Résous ${n} nouvel exercice du 1er coup`
    default: return q.kind
  }
}
export function questProgress (q, ds) {
  switch (q.kind) {
    case 'due': return ds.due
    case 'fresh': return ds.fresh
    case 'lines': return ds.lines
    case 'flawless': return ds.flawless
    case 'combo': return ds.comboMax
    case 'pick': return ds.openings.has(q.openingId) ? 1 : 0
    case 'side': return ds.sides[q.side] || 0
    case 'xp': return ds.xp
    case 'rush': return ds.rushMax
    case 'puzzles': return ds.puzzles
    case 'drills': return ds.drills
    case 'newPuzzle': return ds.cleanPuzzles
    default: return 0
  }
}

// ---------- coffre ----------
// Ouvert quand les 3 défis du jour sont relevés. Récompense variable, fixée par le jour.
export function chestReward (day) {
  const rand = createRng(`chest:${day}`)
  const x = rand()
  if (x < 0.5) return { kind: 'xp', xp: 20 + Math.floor(rand() * 41) }
  if (x < 0.7) return { kind: 'freeze', xp: 0 }
  if (x < 0.9) return { kind: 'boost', xp: 0, minutes: 15 }
  return { kind: 'jackpot', xp: 150 }
}

// ---------- découverte du jour ----------
// Une ouverture du catalogue jamais jouée, courte (12 coups au plus), tirée par le jour ; 6 fois sur 10
// parmi les gambits, attaques, pièges et mats. XP ×2 sur ses lignes ce jour-là.
const FUN_NAME = /gambit|attack|trap|mate|countergambit/i
export function dailyPick (day, openings, playedBefore = new Set()) {
  const pool = openings.filter((o) => !playedBefore.has(o.id) && o.moves.length <= 12)
  const fun = pool.filter((o) => FUN_NAME.test(o.name))
  const rand = createRng(`pick:${day}`)
  const src = fun.length && rand() < 0.6 ? fun : pool
  return src.length ? src[Math.floor(rand() * src.length)].id : null
}

// ---------- trophées ----------
// Métriques monotones (jamais en baisse), tirées du journal : un trophée ne se reperd pas.
export const TIER_XP = [25, 50, 100]
export const TIER_LABEL = ['Bronze', 'Argent', 'Or']
export const ACHIEVEMENTS = [
  { id: 'lines', name: 'Studieux', desc: 'Termine {n} lignes', tiers: [10, 100, 1000], metric: (c) => c.lines },
  { id: 'flawless', name: 'Sans bavure', desc: 'Réussis {n} lignes sans faute', tiers: [10, 100, 500], metric: (c) => c.flawless },
  { id: 'due', name: "Mémoire d'éléphant", desc: "Révise {n} lignes à l'heure", tiers: [10, 100, 500], metric: (c) => c.due },
  { id: 'mastered', name: 'Maîtrise', desc: 'Maîtrise {n} lignes', tiers: [5, 50, 250], metric: (c) => c.masteredLines.size },
  { id: 'streak', name: 'Régularité', desc: 'Tiens une série de {n} jours', tiers: [3, 7, 30], metric: (c) => c.streakBest },
  { id: 'combo', name: 'Combo', desc: 'Atteins un combo de {n}', tiers: [10, 25, 50], metric: (c) => c.comboBest },
  { id: 'openings', name: 'Curieux', desc: 'Joue {n} ouvertures différentes', tiers: [3, 15, 50], metric: (c) => c.openings.size },
  { id: 'ecos', name: 'Cartographe', desc: 'Explore {n} codes ECO', tiers: [10, 50, 150], metric: (c) => c.ecos.size },
  { id: 'volumes', name: 'Les 5 volumes', desc: 'Joue une ouverture de chaque volume ECO, de A à E', tiers: [5], metric: (c) => c.volumes.size },
  { id: 'gambits', name: 'Gambiteur', desc: 'Joue {n} gambits différents', tiers: [3, 10, 25], metric: (c) => c.gambits.size },
  { id: 'rush', name: 'Rush', desc: 'Marque {n} points au Rush', tiers: [10, 25, 40], metric: (c) => c.rushBest },
  { id: 'mates', name: 'Mateur', desc: 'Termine {n} {lignes} sur un échec et mat', tiers: [1, 10, 50], metric: (c) => c.mates },
  { id: 'quests', name: 'Défis', desc: 'Relève {n} défis du jour', tiers: [10, 50, 200], metric: (c) => c.quests },
  { id: 'chests', name: 'Chasseur de trésors', desc: 'Ouvre {n} coffres', tiers: [3, 15, 50], metric: (c) => c.chests },
  { id: 'goal', name: 'Objectif', desc: 'Atteins ton objectif du jour {n} fois', tiers: [7, 30, 100], metric: (c) => c.goalDays },
  { id: 'both', name: 'Ambidextre', desc: 'Termine {n} lignes avec chaque camp', tiers: [10], metric: (c) => Math.min(c.sides.white, c.sides.black) },
  { id: 'fast', name: 'Éclair', desc: 'Termine une ligne sans faute en moins de 20 secondes', tiers: [1], metric: (c) => c.fast },
  { id: 'night', name: 'Noctambule', desc: 'Termine une ligne après 23 h', tiers: [1], metric: (c) => c.night },
  { id: 'early', name: 'Lève-tôt', desc: 'Termine une ligne avant 7 h', tiers: [1], metric: (c) => c.early },
]
export function achievementsOf (counters) {
  return ACHIEVEMENTS.map((a) => {
    const value = a.metric(counters)
    const tier = a.tiers.filter((t) => value >= t).length
    const target = a.tiers[Math.min(tier, a.tiers.length - 1)]
    const xp = a.tiers.length === 1 ? (tier ? 50 : 0) : TIER_XP.slice(0, tier).reduce((s, x) => s + x, 0)
    const desc = a.desc.replace('{n}', target).replace('{lignes}', target > 1 ? 'lignes' : 'ligne')
    return { id: a.id, name: a.name, desc, tier, tiers: a.tiers, value, target, xp, done: tier === a.tiers.length }
  })
}

// ---------- reprise de la progression antérieure ----------
// 1 événement 'history' au 1er lancement du jeu : l'XP des passages déjà enregistrés dans `progress`,
// et les ouvertures déjà jouées (elles ne comptent pas comme découvertes ensuite).
export function historyFromProgress (progress = {}) {
  let lines = 0
  let runs = 0
  let flawless = 0
  let mastered = 0
  const openings = []
  for (const [openingId, sub] of Object.entries(progress)) {
    const entries = Object.values(sub || {})
    if (!entries.length) continue
    openings.push(openingId)
    for (const e of entries) {
      lines++
      runs += e.runs || 0
      flawless += e.flawless || 0
      if (e.box >= 3 && !(e.lastErrors > 0)) mastered++
    }
  }
  return { xp: flawless * 8 + (runs - flawless) * 3 + mastered * 20, data: { lines, runs, flawless, mastered, openings } }
}
// Jours actifs connus de `progress` (champ days de chaque ligne) : la série antérieure au jeu compte.
export function progressDays (progress = {}) {
  const days = new Set()
  for (const sub of Object.values(progress)) for (const e of Object.values(sub || {})) for (const d of e.days || []) days.add(d)
  return days
}

// ---------- dérivation de l'état de jeu ----------
function emptyDay (day) {
  return {
    day, xp: 0, questXp: 0, lines: 0, flawless: 0, due: 0, fresh: 0, comboMax: 0, rushMax: 0, rushes: 0, puzzles: 0, cleanPuzzles: 0, drills: 0,
    sides: { white: 0, black: 0 }, openings: new Set(), discovered: new Set(),
  }
}
const GAMBIT_NAME = /gambit/i

// deriveGame(events, { now, goal, legacyDays, meta }) : meta(openingId) -> { side, eco, name } | null.
export function deriveGame (events = [], { now = Date.now(), goal = DEFAULT_GOAL, legacyDays = new Set(), meta = () => null } = {}) {
  const today = localDateStr(now)
  const byDay = new Map()
  const dayOf = (day) => {
    if (!byDay.has(day)) byDay.set(day, emptyDay(day))
    return byDay.get(day)
  }
  const firstDay = new Map()
  const seenPuzzleRefs = new Set()
  const questsByDay = new Map()
  const goalByDay = new Map() // objectif en vigueur au tirage des défis de ce jour
  const chestByDay = new Map()
  const grants = new Map()
  const c = {
    lines: 0, flawless: 0, due: 0, fresh: 0, mates: 0, fast: 0, night: 0, early: 0, quests: 0, chests: 0,
    goalDays: 0, comboBest: 0, rushBest: 0, streakBest: 0, puzzles: 0, puzzlesSolved: 0, sides: { white: 0, black: 0 },
    openings: new Set(), ecos: new Set(), volumes: new Set(), gambits: new Set(), masteredLines: new Set(),
  }
  let eventXp = 0
  let boostUntil = 0

  const touchOpening = (openingId, day, ds) => {
    if (!firstDay.has(openingId)) {
      firstDay.set(openingId, day)
      ds?.discovered.add(openingId)
    }
    c.openings.add(openingId)
    const m = meta(openingId)
    if (m?.eco) { c.ecos.add(m.eco); c.volumes.add(m.eco[0]) }
    if (m?.name && GAMBIT_NAME.test(m.name)) c.gambits.add(openingId)
    return m
  }

  for (const e of sortEvents(events)) {
    const xp = e.xp || 0
    eventXp += xp
    if (e.kind === 'history') {
      for (const openingId of e.data?.openings || []) touchOpening(openingId, e.day, null)
      continue
    }
    if (e.kind === 'quests') {
      if (!questsByDay.has(e.day)) questsByDay.set(e.day, e.data?.list || [])
      if (e.data?.goal && !goalByDay.has(e.day)) goalByDay.set(e.day, e.data.goal)
      continue
    }
    const ds = dayOf(e.day)
    ds.xp += xp
    if (e.kind === 'line') {
      const d = e.data || {}
      ds.lines++
      c.lines++
      if (d.err === 0) { ds.flawless++; c.flawless++ }
      if (d.ph === 'due') { ds.due++; c.due++ }
      if (d.ph === 'new') { ds.fresh++; c.fresh++ }
      if (d.mate) c.mates++
      if (d.mst) c.masteredLines.add(`${d.o}|${d.l}`)
      if (d.err === 0 && d.ms > 0 && d.ms < 20000) c.fast++
      const hour = new Date(e.at).getHours()
      if (hour >= 23) c.night++
      if (hour < 7) c.early++
      ds.comboMax = Math.max(ds.comboMax, d.combo || 0)
      c.comboBest = Math.max(c.comboBest, d.combo || 0)
      ds.openings.add(d.o)
      const m = touchOpening(d.o, e.day, ds)
      if (m?.side === 'white' || m?.side === 'black') { ds.sides[m.side]++; c.sides[m.side]++ }
    } else if (e.kind === 'puzzle') {
      ds.puzzles++
      c.puzzles++
      if (e.data?.result === 'solved') c.puzzlesSolved++
      if (e.data?.ref && !seenPuzzleRefs.has(e.data.ref)) {
        seenPuzzleRefs.add(e.data.ref)
        if (e.data.result === 'solved' && !e.data.errors && !e.data.aided) ds.cleanPuzzles++
      }
    } else if (e.kind === 'drill') {
      if (!e.data?.errors && !e.data?.aided) ds.drills++
    } else if (e.kind === 'rush') {
      const score = e.data?.score || 0
      ds.rushes++
      ds.rushMax = Math.max(ds.rushMax, score)
      c.rushBest = Math.max(c.rushBest, score)
    } else if (e.kind === 'chest') {
      if (chestByDay.has(e.day)) continue
      chestByDay.set(e.day, e.data?.reward || null)
      c.chests++
      const reward = e.data?.reward
      if (reward?.kind === 'freeze') grants.set(e.day, (grants.get(e.day) || 0) + 1)
      if (reward?.kind === 'boost') boostUntil = Math.max(boostUntil, e.at + (reward.minutes || 15) * 60000)
    }
  }

  let questXp = 0
  const questsOfDay = (day) => {
    const ds = byDay.get(day) || emptyDay(day)
    return (questsByDay.get(day) || []).map((q) => {
      const progress = questProgress(q, ds)
      return { ...q, progress: Math.min(progress, q.target), done: progress >= q.target }
    })
  }
  for (const day of questsByDay.keys()) {
    for (const q of questsOfDay(day)) {
      if (!q.done) continue
      questXp += q.xp
      c.quests++
      dayOf(day).questXp += q.xp
    }
  }

  const activeDays = new Set(legacyDays)
  for (const [day, ds] of byDay) if (ds.lines || ds.rushes || ds.puzzles) activeDays.add(day)
  const streak = streakOf(activeDays, { today, grants })
  c.streakBest = streak.best
  // Chaque jour passé se juge sur l'objectif en vigueur ce jour-là : relever son objectif ne fait
  // pas reperdre un palier du trophée « Objectif ». Aujourd'hui suit le réglage courant.
  for (const ds of byDay.values()) if (ds.xp + ds.questXp >= (ds.day === today ? goal : goalByDay.get(ds.day) ?? goal)) c.goalDays++

  const achievements = achievementsOf(c)
  const achievementXp = achievements.reduce((s, a) => s + a.xp, 0)
  const xp = eventXp + questXp + achievementXp

  const todayStats = byDay.get(today) || emptyDay(today)
  const quests = questsOfDay(today)
  const todayXp = todayStats.xp + todayStats.questXp
  const history = []
  for (let k = 13; k >= 0; k--) {
    const day = addDays(today, -k)
    const ds = byDay.get(day)
    history.push({ day, xp: ds ? ds.xp + ds.questXp : 0, active: activeDays.has(day) })
  }
  const weekXp = (from, to) => history.slice(from, to).reduce((s, h) => s + h.xp, 0)

  return {
    xp,
    level: levelOf(xp),
    today: {
      ...todayStats,
      xp: todayXp,
      goal,
      goalMet: todayXp >= goal,
      quests,
      questsGenerated: questsByDay.has(today),
      chest: {
        opened: chestByDay.get(today) ?? null,
        available: quests.length > 0 && quests.every((q) => q.done) && !chestByDay.has(today),
      },
    },
    streak,
    boost: boostUntil > now ? { until: boostUntil } : null,
    counters: c,
    achievements,
    history,
    week: { xp: weekXp(7, 14), prevXp: weekXp(0, 7) },
    days: byDay,
    firstDay,
  }
}

// Contexte de tirage des défis du jour : la semaine écoulée (jours actifs seulement), le record de
// combo des 14 derniers jours, le camp le moins joué quand le répertoire a les 2 camps.
export function questContext (game, { dueCount = 0, newAvailable = 0, goal = DEFAULT_GOAL, repertoireSides = [], rushReady = false, pick = null, today } = {}) {
  const week = []
  let bestCombo = 0
  for (let k = 1; k <= 14; k++) {
    const ds = game.days.get(addDays(today, -k))
    if (!ds) continue
    bestCombo = Math.max(bestCombo, ds.comboMax)
    if (k <= 7 && ds.lines) week.push(ds)
  }
  const avg = (key) => (week.length ? week.reduce((s, ds) => s + ds[key], 0) / week.length : 0)
  let weakSide = null
  if (repertoireSides.includes('white') && repertoireSides.includes('black')) {
    const sides = { white: 0, black: 0 }
    for (const ds of week) { sides.white += ds.sides.white; sides.black += ds.sides.black }
    weakSide = sides.black < sides.white ? 'black' : sides.white < sides.black ? 'white' : null
  }
  return {
    avgLines: avg('lines'), avgFlawless: avg('flawless'), bestCombo, rushBest: game.counters.rushBest,
    dueCount, newAvailable, goal, weakSide, rushReady, pick,
  }
}

// ---------- mémoire ----------
// Probabilité de rappel d'une ligne, courbe d'oubli exponentielle : demi-vie par boîte de Leitner,
// réglée pour valoir environ 75 % à l'échéance de la boîte (boîte 3 : 3 jours, demi-vie 7 jours).
// Une ligne ratée au dernier passage retombe à une demi-vie de 12 h.
export const HALF_LIFE_DAYS = [0.5, 0.5, 2.5, 7, 17, 50]
export function lastRunOf (entry) {
  return entry.lastRun ?? Math.max(0, (entry.due ?? 0) - (INTERVALS[entry.box] ?? 0))
}
export function recallProbability (entry, now = Date.now()) {
  if (!entry) return null
  const box = clamp(entry.box || 0, 0, HALF_LIFE_DAYS.length - 1)
  const half = (entry.lastErrors > 0 ? HALF_LIFE_DAYS[1] : HALF_LIFE_DAYS[box]) * DAY
  return Math.pow(2, -Math.max(0, now - lastRunOf(entry)) / half)
}
// Mémoire d'une ouverture : moyenne des probabilités de ses lignes déjà jouées ; null sans ligne jouée.
export function openingMemory (lines, progress = {}, now = Date.now()) {
  const scored = lines.filter((l) => progress[l.id]).map((l) => ({ id: l.id, p: recallProbability(progress[l.id], now) }))
  if (!scored.length) return null
  scored.sort((a, b) => a.p - b.p)
  return { memory: scored.reduce((s, x) => s + x.p, 0) / scored.length, played: scored.length, total: lines.length, weakest: scored }
}

// ---------- Rush ----------
// Positions du Rush : chaque coup de mon camp d'une ligne déjà jouée, 1 fois par position (les lignes
// d'un arbre partagent leur début). Poids : ce que j'oublie (1,2 − probabilité de rappel), plus les
// coups marqués faibles.
const isMine = (ply, side) => (side === 'white' ? ply % 2 === 0 : ply % 2 === 1)
export function rushPositions (items, now = Date.now()) {
  const seen = new Set()
  const out = []
  for (const { openingId, side, lines, progress = {} } of items) {
    for (const line of lines) {
      const entry = progress[line.id]
      if (!entry) continue
      const p = recallProbability(entry, now)
      for (let ply = 0; ply < line.moves.length; ply++) {
        if (!isMine(ply, side)) continue
        const key = `${openingId}|${line.moves.slice(0, ply).join(' ')}`
        if (seen.has(key)) continue
        seen.add(key)
        const weak = (entry.weak || []).includes(ply)
        out.push({ key, openingId, side, lineId: line.id, moves: line.moves, alts: line.alts?.[ply] || [], ply, weight: 1.2 - p + (weak ? 0.6 : 0) })
      }
    }
  }
  return out
}
// Tirage pondéré, en évitant les positions récentes tant qu'il en reste d'autres.
export function drawRush (positions, rand, recent = new Set()) {
  const pool = positions.filter((p) => !recent.has(p.key))
  const src = pool.length ? pool : positions
  if (!src.length) return null
  const total = src.reduce((s, p) => s + p.weight, 0)
  let x = rand() * total
  for (const p of src) {
    x -= p.weight
    if (x < 0) return p
  }
  return src[src.length - 1]
}
export const RUSH = { seconds: 180, lives: 3, bonusEvery: 5, bonusSeconds: 5, minPositions: 5 }
export const rushXp = (score, record) => score * 2 + (record ? 25 : 0)
