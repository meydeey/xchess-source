// Métriques pures du catalogue d'ouvertures (spec docs/reference/contrats.md, 14.4).
// Aucune dépendance à Bun ni au DOM : importable par les outils (tools/build-stats.mjs) et par l'app.

// Tranches Elo Lichess retenues pour l'explorateur (section 4). `ratings` = tranches de
// l'explorateur (https://lichess.org/api#tag/Opening-Explorer), `min`/`max` = bornes en Elo
// Lichess, utilisées par eloToBand. Ordre croissant : l'itération dans cet ordre sert à la
// conversion (eloToBand).
export const BANDS = {
  debutant: { min: 0, max: 1199, ratings: [0, 1000] },
  intermediaire: { min: 1200, max: 1599, ratings: [1200, 1400] },
  club: { min: 1600, max: 1999, ratings: [1600, 1800] },
  avance: { min: 2000, max: 2199, ratings: [2000] },
  expert: { min: 2200, max: Infinity, ratings: [2200, 2500] },
}

// Score d'un camp : victoires de ce camp + moitié des nulles, sur le total. w et l sont déjà du
// point de vue du camp mesuré (l'appelant choisit quel compteur Lichess est une victoire et
// lequel est une défaite selon le camp). 0 partie : conventionnellement 0 (aucune preuve).
export function score(w, d, l) {
  const n = w + d + l
  if (n === 0) return 0
  return (w + d / 2) / n
}

// Borne basse de l'intervalle de Wilson à 95 % (z = 1,96) autour d'un score sur n parties.
// Écrase les scores extrêmes sur peu de parties (60 % sur 40 parties ne prouve rien).
const Z = 1.96
export function wilsonLow(p, n) {
  if (n === 0) return 0
  const z2 = Z * Z
  const centre = p + z2 / (2 * n)
  const marge = Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  const denom = 1 + z2 / n
  return Math.max(0, (centre - marge) / denom)
}

// Stats d'une tranche pour une ouverture, à partir de 2 requêtes d'explorateur (14.4) :
// - parentExplorer : réponse de l'explorateur à la position parente de la position finale
//   ({ white, draws, black, moves }), sert de référence (baseline) au camp mesuré.
// - childMove : l'entrée de parentExplorer.moves qui correspond au dernier coup de l'ouverture
//   ({ white, draws, black }), ses compteurs = les parties qui atteignent la position finale.
// - side : 'white' ou 'black', le camp dont on mesure le score.
export function bandStats(parentExplorer, childMove, side) {
  const games = childMove.white + childMove.draws + childMove.black
  const finalScore = side === 'white'
    ? score(childMove.white, childMove.draws, childMove.black)
    : score(childMove.black, childMove.draws, childMove.white)
  const baseline = side === 'white'
    ? score(parentExplorer.white, parentExplorer.draws, parentExplorer.black)
    : score(parentExplorer.black, parentExplorer.draws, parentExplorer.white)
  return {
    games,
    white: childMove.white,
    draws: childMove.draws,
    black: childMove.black,
    score: finalScore,
    scoreLow: wilsonLow(finalScore, games),
    baseline,
    gain: finalScore - baseline,
  }
}

// Place une valeur dans un niveau 1 à 5 selon 4 seuils croissants (dépasser un seuil monte d'un
// niveau). Utilisé pour la charge théorique et le tranchant.
function bucketAsc(value, thresholds) {
  return 1 + thresholds.filter((t) => value > t).length
}

// Charge d'apprentissage : nombre de variantes × longueur moyenne. Les coups forcés réduisent
// légèrement le travail de choix, sans effacer les coups à mémoriser. L'évaluation de la position
// finale ne mesure pas ce travail. Seuils fixes pour la sélection et le catalogue complet.
export function difficulty({ lines, avgOwnMoves, forcedShare }) {
  const load = Math.max(0, lines || 0) * Math.max(0, avgOwnMoves || 0) *
    (1 - 0.4 * Math.min(1, Math.max(0, forcedShare || 0)))
  return bucketAsc(load, [25, 45, 80, 450])
}

// Conversion approximative vers l'Elo Lichess (14.4), à calibrer en phase 1 (section 4). Faute de
// données croisées officielles, décalages tirés des comparaisons communautaires les plus citées :
// Chess.com (rapide/blitz) est en général ~400 points sous Lichess au niveau débutant/club, et la
// FIDE ~200 points sous Lichess au même niveau ; l'écart se resserre en montant en Elo. 400 Elo
// Chess.com donne donc 800 Lichess, tranche debutant.
const ELO_OFFSET = { lichess: 0, chesscom: 400, fide: 200 }
export function eloToBand(elo, source = 'lichess') {
  const lichessElo = elo + (ELO_OFFSET[source] ?? 0)
  for (const [id, band] of Object.entries(BANDS)) {
    if (lichessElo <= band.max) return id
  }
  return 'expert'
}
