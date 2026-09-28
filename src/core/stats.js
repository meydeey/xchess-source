// Statistiques d'entraînement (spec section 6, chantier E3). Pur : ne lit que les structures déjà en
// mémoire (lignes, progress), aucune dépendance à Vite, au DOM ou au store. Consommé par
// src/ui/stats.js (écran Statistiques) et par src/ui/session.js (introducedTodayCount, en
// remplacement de la reconstruction précédente).
import { statusOf, localDateStr, DAY } from './srs.js'

// ---------- statistiques d'une ouverture ----------
// openingStats(lines, progress) : lines = sortie de linesFromTree pour CETTE ouverture ; progress =
// la tranche de progression de cette même ouverture ({ [lineId]: entrée }, format 14.6/srs.js).
// `flawless` peut manquer sur une entrée créée avant ce chantier (rétrocompatibilité) : traité comme
// 0, jamais comme une erreur.
export function openingStats (lines = [], progress = {}) {
  let runs = 0
  let flawless = 0
  let mastered = 0
  let learning = 0
  let review = 0
  let fresh = 0
  for (const line of lines) {
    const p = progress[line.id]
    if (!p) { fresh++; continue }
    runs += p.runs || 0
    flawless += p.flawless || 0
    const status = statusOf(progress, line.id)
    if (status === 'mastered') mastered++
    else if (status === 'learning') learning++
    else if (status === 'review') review++
  }
  return { runs, flawless, successRate: runs ? flawless / runs : null, mastered, learning, review, fresh, total: lines.length }
}

// aggregateStats(list) : somme plusieurs openingStats (une par ouverture du répertoire) en un seul
// total, avec un taux de réussite recalculé sur les compteurs bruts (jamais une moyenne de taux, qui
// pondérerait mal les ouvertures peu jouées).
export function aggregateStats (list = []) {
  const sum = (key) => list.reduce((s, o) => s + (o[key] || 0), 0)
  const runs = sum('runs')
  const flawless = sum('flawless')
  return {
    runs,
    flawless,
    successRate: runs ? flawless / runs : null,
    mastered: sum('mastered'),
    learning: sum('learning'),
    review: sum('review'),
    fresh: sum('fresh'),
    total: sum('total'),
  }
}

// ---------- lignes introduites aujourd'hui, tout le répertoire ----------
// introducedTodayCount(progress, repertoire, now) : remplace la reconstruction précédente de
// src/ui/session.js (qui devinait l'instant d'introduction depuis due/lastErrors) par une lecture
// directe du champ `introduced` écrit par recordRun.
export function introducedTodayCount (progress = {}, repertoire = [], now = Date.now()) {
  const today = localDateStr(now)
  let count = 0
  for (const openingId of repertoire) {
    for (const entry of Object.values(progress[openingId] || {})) {
      if (entry.introduced === today) count++
    }
  }
  return count
}

// ---------- jours actifs, tout le répertoire ----------
// Union des `days` de toutes les lignes de toutes les ouvertures du répertoire : un jour est actif
// dès qu'au moins une ligne y a été jouée, quelle que soit l'ouverture.
function activeDaySet (progress, repertoire) {
  const days = new Set()
  for (const openingId of repertoire) {
    for (const entry of Object.values(progress[openingId] || {})) {
      for (const d of entry.days || []) days.add(d)
    }
  }
  return days
}
function shiftedDateStr (now, deltaDays) {
  const d = new Date(now)
  d.setDate(d.getDate() + deltaDays)
  return localDateStr(d.getTime())
}

// Série de jours consécutifs jusqu'à aujourd'hui : si aujourd'hui n'a encore aucune ligne jouée, la
// série d'hier compte encore (elle n'est pas cassée avant la fin du jour) ; sinon, un jour sans
// aucune ligne jouée la remet à 0.
function computeStreak (days, now) {
  const today = shiftedDateStr(now, 0)
  const yesterday = shiftedDateStr(now, -1)
  let offset
  if (days.has(today)) offset = 0
  else if (days.has(yesterday)) offset = 1
  else return 0
  let count = 0
  while (days.has(shiftedDateStr(now, -(offset + count)))) count++
  return count
}

// Jours actifs sur les `window` derniers jours (aujourd'hui inclus).
function countActiveWithin (days, now, window) {
  let count = 0
  for (let i = 0; i < window; i++) {
    if (days.has(shiftedDateStr(now, -i))) count++
  }
  return count
}

// ---------- statistiques globales ----------
// globalStats({ repertoire, linesByOpening, progress, now }) : linesByOpening n'est pas utilisé pour
// le moment (les statistiques globales ne dépendent que de progress), il est accepté pour rester
// symétrique de buildSession et permettre une évolution sans changer l'appelant.
export function globalStats ({ repertoire = [], progress = {}, now = Date.now() } = {}) {
  const days = activeDaySet(progress, repertoire)
  return {
    streak: computeStreak(days, now),
    activeDays30: countActiveWithin(days, now, 30),
    introducedToday: introducedTodayCount(progress, repertoire, now),
  }
}

export { DAY }
