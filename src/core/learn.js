// Cycle d'apprentissage guidé (spec docs/reference/contrats.md, section 15.1, chantier
// X2 de la V1.1) : calcule, pour une ligne et son état de progression, le plus long préfixe déjà
// connu, la suite de phases à jouer selon le statut de la ligne (statusOf de srs.js), et gère le
// champ `weak` (coups faibles) d'une entrée de progress. Pur : aucune dépendance au DOM, à Vite, à un
// store ou à srs.js (pas d'import circulaire) ; c'est src/ui/trainer.js et src/ui/session.js qui
// orchestrent ces briques avec le plateau et le store. Le statut d'une ligne n'est pas recalculé ici :
// learn.js reçoit toujours un statut déjà tranché par l'appelant (statusOf(progress, lineId)).

function isMyPly (ply, side) {
  return side === 'white' ? ply % 2 === 0 : ply % 2 === 1
}

// knownPrefixLength(line, lines, progress) : le plus long préfixe (en demi-coups) que `line` partage
// avec une AUTRE ligne de la même ouverture déjà jouée au moins une fois (présente dans `progress`,
// la tranche de progress d'UNE ouverture, comme pour srs.js). Une ligne jamais jouée ne compte pas
// comme connue, même si elle a le même début : c'est le premier passage sur CETTE ligne qui reste
// entièrement à découvrir tant qu'aucune autre n'a établi son préfixe. Rend 0 si rien n'est commun.
export function knownPrefixLength (line, lines, progress = {}) {
  let best = 0
  for (const other of lines) {
    if (other.id === line.id) continue
    if (!progress[other.id]) continue
    const max = Math.min(line.moves.length, other.moves.length)
    let i = 0
    while (i < max && line.moves[i] === other.moves[i]) i++
    if (i > best) best = i
  }
  return best
}

// phasesFor(status) : la suite de phases à jouer pour cette ligne (spec 15.1). 'new' (jamais jouée,
// statusOf) : Découvrir puis Rappeler, enchaînés sur la même ligne. Tout le reste (une ligne due ou
// ratée, l'appelant ne propose jamais ici une ligne qui n'est ni due ni neuve) : Réviser seul, coups
// faibles guidés.
export function phasesFor (status) {
  return status === 'new' ? ['discover', 'recall'] : ['review']
}

// showCardAt(phase, ply, side, { knownPrefix, weak, justErred }) : ce demi-coup a-t-il droit à la
// fiche d'explication ? 'discover' : tout coup à partir du préfixe déjà connu (les 2 camps, le début
// connu se joue sans aide). 'recall' : jamais AVANT le coup (rappel sans aide, spec 15.1) ; mais une
// erreur montre le bon coup avec sa fiche (spec 15.1) - c'est `justErred: true` qui déclenche cette
// fiche réactive, jamais affichée par avance. 'review' : seulement mes coups marqués faibles (rappel
// guidé ciblé, jamais les coups adverses), affichée par avance comme après une erreur.
export function showCardAt (phase, ply, side, { knownPrefix = 0, weak = [], justErred = false } = {}) {
  if (phase === 'discover') return ply >= knownPrefix
  if (phase === 'review') return isMyPly(ply, side) && weak.includes(ply)
  if (phase === 'recall') return justErred
  return false
}

// countsErrors(phase) : seul Rappeler et Réviser comptent une faute (Rappeler alimente les révisions
// espacées, spec 15.1 : "seul ce passage compte" ; Réviser compte pour re-marquer un coup faible).
// Découvrir ne compte jamais de faute : le coup est imposé, un autre essai est refusé sans y toucher.
export function countsErrors (phase) {
  return phase !== 'discover'
}

// markWeak(weak, ply) / clearWeak(weak, ply) : ajoute ou retire un demi-coup du champ `weak` d'une
// entrée de progress (rétrocompatible : weak absent = []), sans doublon, trié par ordre croissant.
export function markWeak (weak, ply) {
  const w = weak || []
  if (w.includes(ply)) return w
  return [...w, ply].sort((a, b) => a - b)
}
export function clearWeak (weak, ply) {
  const w = weak || []
  return w.includes(ply) ? w.filter((p) => p !== ply) : w
}

// explainKeyFor(moves, ply) : clé d'un nœud du fichier d'explications (spec 15.2), "les coups SAN
// depuis le début, séparés par une espace", jusqu'au demi-coup `ply` inclus.
export function explainKeyFor (moves, ply) {
  return moves.slice(0, ply + 1).join(' ')
}
