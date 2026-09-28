// Session du jour : agrège les lignes dues et les lignes neuves de tout le répertoire (plusieurs
// ouvertures), avec un plafond de lignes neuves par jour. Pur, indépendant de srs.js pour le calcul
// du statut (pas d'import circulaire), même règles.

function isDue (p, now) {
  return !!p && p.due <= now
}
function isReview (p) {
  return !!p && p.lastErrors > 0
}

// buildSession({ repertoire, linesByOpening, progress, now, newPerDay, introducedToday }) :
// - repertoire : [openingId], les ouvertures de mon répertoire.
// - linesByOpening : { [openingId]: ligne[] }, sortie de linesFromTree pour chaque ouverture.
// - progress : { [openingId]: { [lineId]: { box, due, lastErrors, runs } } }, format du store 14.6.
// - newPerDay : plafond de lignes neuves par jour ; introducedToday : déjà entamées aujourd'hui.
// Rend { queue, dueCount, newCount, total } : queue = [{ openingId, line, isNew }] dans l'ordre de
// jeu (ratées, puis dues, puis neuves dans l'ordre de l'arbre), jusqu'au plafond restant.
export function buildSession ({ repertoire = [], linesByOpening = {}, progress = {}, now = Date.now(), newPerDay = 10, introducedToday = 0 } = {}) {
  const due = []
  const fresh = []
  for (const openingId of repertoire) {
    const lines = linesByOpening[openingId] || []
    const openingProgress = progress[openingId] || {}
    for (const line of lines) {
      const p = openingProgress[line.id]
      if (isDue(p, now)) due.push({ openingId, line, due: p.due, review: isReview(p) })
      else if (!p) fresh.push({ openingId, line })
    }
  }
  due.sort((a, b) => (b.review - a.review) || a.due - b.due)
  const remainingNew = Math.max(0, newPerDay - introducedToday)
  const news = fresh.slice(0, remainingNew)
  const queue = [
    ...due.map(({ openingId, line }) => ({ openingId, line, isNew: false })),
    ...news.map(({ openingId, line }) => ({ openingId, line, isNew: true })),
  ]
  return { queue, dueCount: due.length, newCount: news.length, total: queue.length }
}

// starterRepertoire(selection, { difficultyOf, scoreOf }) : répertoire de départ (spec V2 L3, D7).
// 3 ouvertures qui partent du 1er coup de mon camp : 1er coup blanc, réponse noire à 1.e4, réponse
// noire à 1.d4 ; difficulté 3 au plus si possible, sinon charge minimale dans le créneau, puis
// meilleur score prudent. difficultyOf(id) et scoreOf(id) rendent null quand la valeur manque
// (l'ouverture est alors écartée, ou classée en dernier pour le score). Rend 0 à 3 ouvertures.
export function starterRepertoire (selection = [], { difficultyOf = () => null, scoreOf = () => null } = {}) {
  const slots = [
    (o) => o.side === 'white' && o.moves.length === 1,
    (o) => o.side === 'black' && o.moves.length === 2 && o.moves[0] === 'e4',
    (o) => o.side === 'black' && o.moves.length === 2 && o.moves[0] === 'd4',
  ]
  const out = []
  for (const fits of slots) {
    const candidates = selection.filter((o) => fits(o) && difficultyOf(o.id) != null)
    const approachable = candidates.filter((o) => difficultyOf(o.id) <= 3)
    const easiest = Math.min(...candidates.map((o) => difficultyOf(o.id)))
    const pool = approachable.length ? approachable : candidates.filter((o) => difficultyOf(o.id) === easiest)
    const best = pool.sort((a, b) => (scoreOf(b.id) ?? -1) - (scoreOf(a.id) ?? -1))[0]
    if (best) out.push(best)
  }
  return out
}
