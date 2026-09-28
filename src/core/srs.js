// Répétition espacée façon boîtes de Leitner, portée de l'entraîneur Alien Gambit et généralisée à
// plusieurs ouvertures. Pur : reçoit et rend l'état, n'écrit jamais dans un store lui-même.
// progress ici = la tranche d'UNE ouverture, { [lineId]: { box, due, lastErrors, runs, flawless,
// lastRun, days, introduced } } : c'est l'appelant (session.js, ou l'interface) qui choisit la
// tranche dans le store nesté par ouverture.

export const DAY = 86400000
export const INTERVALS = [0, 10 * 60000, DAY, 3 * DAY, 7 * DAY, 21 * DAY]
const MAX_DAYS = 90

// Date locale AAAA-MM-JJ d'un horodatage (fuseau de la machine, pas UTC) : sert de clé de jour pour
// `days`, `introduced` et les statistiques (core/stats.js).
export function localDateStr (ts) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// new : jamais jouée. review : dernier passage fautif. mastered : boîte 3 ou plus, sans faute.
// learning : sans faute mais encore dans les premières boîtes.
export function statusOf (progress, lineId) {
  const p = progress[lineId]
  if (!p) return 'new'
  if (p.lastErrors > 0) return 'review'
  return p.box >= 3 ? 'mastered' : 'learning'
}

// recordRun(progress, lineId, errors, now) : rend une NOUVELLE map progress (immutable), avec
// l'entrée de lineId mise à jour. errors = nombre de fautes pendant ce passage.
// Champs de statistiques (chantier E3), en plus de box/due/lastErrors/runs :
// - flawless : nombre total de runs sans faute sur cette ligne (jamais remis à 0, contrairement à
//   box qui retombe à 1 sur une faute).
// - lastRun : horodatage de ce passage.
// - days : dates locales AAAA-MM-JJ distinctes des runs sur cette ligne, les 90 dernières.
// - introduced : date locale du premier run. Rétrocompatible : une entrée existante sans ces
//   champs (créée avant ce chantier) les reçoit ici avec des valeurs par défaut sûres ; `introduced`
//   ne peut pas être reconstruit rétroactivement pour une telle entrée, il est donc daté de ce
//   passage, comme pour une ligne réellement neuve.
// - weak (chantier X2, spec 15.1) : indices de demi-coups faibles, EXCLUSIVEMENT géré par l'appelant
//   (src/core/learn.js : markWeak/clearWeak) AVANT d'appeler recordRun, en patchant progress[lineId]
//   immuablement. recordRun ne calcule jamais `weak` lui-même (signature publique inchangée, aucun
//   paramètre en plus) : il se contente de le PORTER d'une entrée à l'autre, pour qu'un appelant qui
//   ignore ce champ (l'ancien entraîneur, avant ce chantier) ne l'efface jamais. Rétrocompatible :
//   une entrée sans `weak` (créée avant ce chantier) en reçoit un tableau vide.
//
// Maîtrise (spec V2, L0 point 5) : seul un rappel DÛ (échéance atteinte) et sans aide fait monter la
// boîte. `aided` (5e paramètre, facultatif) = une fiche a été montrée avant une tentative de ce passage
// (coup faible en Réviser) ; un indice demandé compte déjà comme une faute (trainer.js). Un passage
// réussi hors échéance ou aidé laisse boîte et échéance en place ; une faute renvoie toujours en
// boîte 1. Une ligne neuve entre en boîte 1 quoi qu'il arrive : Découvrir précède son 1er rappel.
export function recordRun (progress, lineId, errors, now = Date.now(), { aided = false } = {}) {
  const existing = progress[lineId]
  const prev = existing || { box: 0, due: 0, lastErrors: 0, runs: 0, flawless: 0, days: [], introduced: null, weak: [] }
  const advances = !existing || (prev.due <= now && !aided)
  let box, due
  if (errors > 0) { box = 1; due = now }
  else if (advances) { box = Math.min(prev.box + 1, INTERVALS.length - 1); due = now + INTERVALS[box] }
  else { box = prev.box; due = prev.due }
  const today = localDateStr(now)
  const prevDays = prev.days || []
  const days = (prevDays.includes(today) ? prevDays : [...prevDays, today]).slice(-MAX_DAYS)
  const entry = {
    box,
    due,
    lastErrors: errors,
    runs: prev.runs + 1,
    flawless: (prev.flawless || 0) + (errors === 0 ? 1 : 0),
    lastRun: now,
    days,
    introduced: prev.introduced || today,
    weak: prev.weak || [],
  }
  return { ...progress, [lineId]: entry }
}

// flagForReview(progress, lineId, ply, now) : une erreur hors séance (Rush, spec V2 L10) ramène la
// ligne dans la prochaine séance sans toucher à sa boîte : échéance avancée à maintenant, coup marqué
// faible. Ce coup faible montre sa fiche avant la tentative : le rappel suivant est aidé et ne fait pas
// monter la boîte (recordRun, `aided`). Ligne jamais jouée : rien ne change.
export function flagForReview (progress, lineId, ply, now = Date.now()) {
  const e = progress[lineId]
  if (!e) return progress
  const weak = e.weak || []
  return {
    ...progress,
    [lineId]: { ...e, due: Math.min(e.due, now), weak: weak.includes(ply) ? weak : [...weak, ply].sort((a, b) => a - b) },
  }
}

// pickNext(lines, progress, { currentId, now }) : privilégie les lignes dues, les ratées (statut
// review) avant les autres, puis la plus ancienne due ; à défaut, la première ligne jamais jouée dans
// l'ordre de l'arbre ; à défaut, la ligne dont l'échéance est la plus proche. N'écarte la ligne
// currentId que s'il reste au moins une autre ligne dans le lot.
export function pickNext (lines, progress, { currentId, now = Date.now() } = {}) {
  const pool = currentId != null && lines.length > 1 ? lines.filter((l) => l.id !== currentId) : lines
  if (!pool.length) return null
  const due = pool
    .filter((l) => progress[l.id] && progress[l.id].due <= now)
    .sort((a, b) => (statusOf(progress, b.id) === 'review') - (statusOf(progress, a.id) === 'review') || progress[a.id].due - progress[b.id].due)
  if (due.length) return due[0]
  const fresh = pool.find((l) => !progress[l.id])
  if (fresh) return fresh
  return pool.slice().sort((a, b) => progress[a.id].due - progress[b.id].due)[0]
}
