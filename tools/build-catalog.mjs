// Construit catalog/openings.json (les 3 815 ouvertures nommées Lichess, licence CC0) et
// catalog/selection.json (les 42 ouvertures de la section 3 de la spec). Spec :
// docs/reference/contrats.md, sections 3 et 14.3. Usage : bun run catalog
import { writeFileSync, mkdirSync } from 'node:fs'
import { Chess } from 'chess.js'
import { fenKey } from './lib/explorer.mjs'

const TSV_LETTERS = ['a', 'b', 'c', 'd', 'e']
const TSV_BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master'
const DATA_DIR = new URL('./data/', import.meta.url)
const CATALOG_DIR = new URL('../catalog/', import.meta.url)

// ---------- slug ASCII (id du catalogue et de la sélection) ----------
function slugify(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Rend un id unique dans `seen`, en ajoutant -2, -3... sur doublon (ordre d'arrivée déterministe).
function uniqueId(name, seen) {
  const base = slugify(name)
  let id = base
  let n = 2
  while (seen.has(id)) { id = `${base}-${n}`; n++ }
  seen.add(id)
  return id
}

// Le camp qui joue le dernier coup de la ligne : Blancs sur un nombre de coups impair.
const sideOf = (moves) => (moves.length % 2 === 1 ? 'white' : 'black')

// `side` suit 2 règles différentes selon le fichier (14.3) : openings.json = dernier coup joué
// (sideRule 'lastMover', littéral), selection.json = camp qui choisit l'ouverture, colonne
// « Camp » de la section 3 (sideRule 'chosen'). Les 2 coïncident presque toujours mais divergent
// quand les coups qui définissent l'ouverture incluent la réponse adverse la plus naturelle à
// titre d'illustration (ex. Partie italienne, jusqu'à 3...Bc5 : chosen=white, lastMover=black).
// `sideRule` est un champ additif, absent du contrat 14.3, ajouté pour qu'aucun code en aval ne
// traite `side` comme un concept unique entre les 2 fichiers : signalé au coordinateur.
const SIDE_RULE_LAST_MOVER = 'lastMover'
const SIDE_RULE_CHOSEN = 'chosen'

function parseMoves(pgnText) {
  const chess = new Chess()
  chess.loadPgn(pgnText)
  return { moves: chess.history(), fen: chess.fen() }
}

// ---------- 1. catalogue complet ----------
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(CATALOG_DIR, { recursive: true })

const rows = []
for (const letter of TSV_LETTERS) {
  const url = `${TSV_BASE}/${letter}.tsv`
  console.log(`téléchargement ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`échec téléchargement ${url} : HTTP ${res.status}`)
  const text = await res.text()
  writeFileSync(new URL(`${letter}.tsv`, DATA_DIR), text)
  const lines = text.split('\n').filter(Boolean)
  for (const line of lines) {
    if (line.startsWith('eco\t')) continue // en-tête
    const [eco, name, pgn] = line.split('\t')
    if (!eco || !name || !pgn) continue
    rows.push({ eco, name, pgn })
  }
}
console.log(`${rows.length} lignes lues dans les 5 TSV`)

const seenIds = new Set()
const openings = []
const byFinalFen = new Map() // fenKey(position finale) -> { name, eco }, sert à selection.json
for (const row of rows) {
  const { moves, fen } = parseMoves(row.pgn)
  const id = uniqueId(row.name, seenIds)
  const opening = { id, eco: row.eco, name: row.name, moves, side: sideOf(moves), sideRule: SIDE_RULE_LAST_MOVER }
  openings.push(opening)
  byFinalFen.set(fenKey(fen), { name: row.name, eco: row.eco })
}
writeFileSync(new URL('openings.json', CATALOG_DIR), JSON.stringify(openings))
console.log(`catalog/openings.json : ${openings.length} ouvertures`)

// ---------- 2. sélection des 42 (section 3 de la spec) ----------
const LEVEL_TO_BAND = { 'Débutant': 'debutant', 'Intermédiaire': 'intermediaire', Club: 'club', 'Avancé': 'avance', Expert: 'expert' }

// [camp, famille, nom français, coups qui la définissent, niveau provisoire]
const SELECTION_TABLE = [
  ['white', 'classique', 'Partie italienne (Giuoco Piano)', '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5', 'Débutant'],
  ['white', 'classique', 'Système de Londres', '1.d4 d5 2.Bf4', 'Débutant'],
  ['white', 'classique', 'Partie écossaise', '1.e4 e5 2.Nf3 Nc6 3.d4', 'Intermédiaire'],
  ['white', 'classique', 'Partie viennoise', '1.e4 e5 2.Nc3', 'Intermédiaire'],
  ['white', 'classique', 'Gambit dame', '1.d4 d5 2.c4', 'Club'],
  ['white', 'classique', 'Attaque Jobava-Londres', '1.d4 Nf6 2.Nc3 d5 3.Bf4', 'Club'],
  ['white', 'classique', 'Partie espagnole', '1.e4 e5 2.Nf3 Nc6 3.Bb5', 'Avancé'],
  ['white', 'classique', 'Ouverture anglaise', '1.c4', 'Avancé'],
  ['white', 'gambit', 'Attaque Fried Liver', '1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5 Nxd5 6.Nxf7', 'Débutant'],
  ['white', 'gambit', 'Gambit danois', '1.e4 e5 2.d4 exd4 3.c3', 'Débutant'],
  ['white', 'gambit', 'Gambit écossais', '1.e4 e5 2.Nf3 Nc6 3.d4 exd4 4.Bc4', 'Intermédiaire'],
  ['white', 'gambit', 'Gambit Évans', '1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4', 'Intermédiaire'],
  ['white', 'gambit', 'Gambit Smith-Morra', '1.e4 c5 2.d4 cxd4 3.c3', 'Intermédiaire'],
  ['white', 'gambit', 'Gambit viennois', '1.e4 e5 2.Nc3 Nf6 3.f4', 'Intermédiaire'],
  ['white', 'gambit', 'Gambit Blackmar-Diemer', '1.d4 d5 2.e4 dxe4 3.Nc3 Nf6 4.f3', 'Club'],
  ['white', 'gambit', 'Gambit du roi', '1.e4 e5 2.f4', 'Club'],
  ['white', 'gambit', 'Alien Gambit', '1.e4 c6 2.d4 d5 3.Nc3 dxe4 4.Nxe4 Nf6 5.Ng5 h6 6.Nxf7', 'Club'],
  ['white', 'exotique', 'Gambit Halloween', '1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6 4.Nxe5', 'Débutant'],
  ['white', 'exotique', 'Gambit Tennison', '1.Nf3 d5 2.e4', 'Intermédiaire'],
  ['white', 'exotique', 'Ouverture polonaise', '1.b4', 'Intermédiaire'],
  ['white', 'exotique', 'Attaque Grob', '1.g4', 'Club'],
  ['black', 'classique', 'Défense scandinave', '1.e4 d5', 'Débutant'],
  ['black', 'classique', 'Défense Caro-Kann', '1.e4 c6', 'Intermédiaire'],
  ['black', 'classique', 'Défense française', '1.e4 e6', 'Club'],
  ['black', 'classique', 'Défense Pirc', '1.e4 d6 2.d4 Nf6 3.Nc3 g6', 'Club'],
  ['black', 'classique', 'Défense slave', '1.d4 d5 2.c4 c6', 'Club'],
  ['black', 'classique', 'Défense hollandaise', '1.d4 f5', 'Club'],
  ['black', 'classique', 'Sicilienne Dragon', '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 g6', 'Avancé'],
  ['black', 'classique', 'Défense est-indienne', '1.d4 Nf6 2.c4 g6 3.Nc3 Bg7', 'Avancé'],
  ['black', 'classique', 'Défense nimzo-indienne', '1.d4 Nf6 2.c4 e6 3.Nc3 Bb4', 'Avancé'],
  ['black', 'classique', 'Sicilienne Najdorf', '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6', 'Expert'],
  ['black', 'classique', 'Défense Grünfeld', '1.d4 Nf6 2.c4 g6 3.Nc3 d5', 'Expert'],
  ['black', 'gambit', 'Gambit Stafford', '1.e4 e5 2.Nf3 Nf6 3.Nxe5 Nc6', 'Débutant'],
  ['black', 'gambit', 'Gambit portugais', '1.e4 d5 2.exd5 Nf6 3.d4 Bg4', 'Intermédiaire'],
  ['black', 'gambit', 'Contre-attaque Traxler', '1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 Bc5', 'Intermédiaire'],
  ['black', 'gambit', 'Gambit Budapest', '1.d4 Nf6 2.c4 e5', 'Intermédiaire'],
  ['black', 'gambit', 'Contre-gambit Albin', '1.d4 d5 2.c4 e5', 'Intermédiaire'],
  ['black', 'gambit', 'Contre-gambit Jaenisch', '1.e4 e5 2.Nf3 Nc6 3.Bb5 f5', 'Club'],
  ['black', 'gambit', 'Gambit Benko', '1.d4 Nf6 2.c4 c5 3.d5 b5', 'Avancé'],
  ['black', 'exotique', 'Gambit Englund', '1.d4 e5', 'Débutant'],
  ['black', 'exotique', 'Gambit letton', '1.e4 e5 2.Nf3 f5', 'Intermédiaire'],
  ['black', 'exotique', "Gambit de l'éléphant", '1.e4 e5 2.Nf3 d5', 'Intermédiaire'],
]
if (SELECTION_TABLE.length !== 42) throw new Error(`sélection : 42 attendues, ${SELECTION_TABLE.length} trouvées`)

// Le plus long préfixe de `moves` dont la position finale est une entrée nommée du catalogue.
function longestNamedPrefix(moves) {
  const chess = new Chess()
  let lastMatch = null
  for (let i = 0; i < moves.length; i++) {
    chess.move(moves[i])
    const hit = byFinalFen.get(fenKey(chess.fen()))
    if (hit) lastMatch = hit
  }
  return lastMatch
}

const selectionSeenIds = new Set()
const selection = []
for (const [side, family, name, movesText, levelLabel] of SELECTION_TABLE) {
  const nameWithoutParens = name.replace(/\s*\([^)]*\)/g, '')
  const id = uniqueId(nameWithoutParens, selectionSeenIds)
  const { moves } = parseMoves(movesText)
  // side vient de la colonne « Camp » du tableau (le camp qui choisit l'ouverture), pas forcément
  // le dernier coup de `moves` : les coups qui la définissent incluent parfois la réponse la plus
  // naturelle de l'adversaire à titre d'illustration (ex. Partie italienne, coups jusqu'à 3...Bc5).
  const lichessMatch = longestNamedPrefix(moves)
  const provisionalLevel = LEVEL_TO_BAND[levelLabel]
  if (!provisionalLevel) throw new Error(`${name} : niveau provisoire inconnu "${levelLabel}"`)
  selection.push({
    id,
    name,
    lichessName: lichessMatch?.name ?? null,
    eco: lichessMatch?.eco ?? null,
    side,
    sideRule: SIDE_RULE_CHOSEN,
    family,
    moves,
    provisionalLevel,
    source: 'spec',
  })
}
writeFileSync(new URL('selection.json', CATALOG_DIR), JSON.stringify(selection, null, 2))
console.log(`catalog/selection.json : ${selection.length} ouvertures`)
const sansMatch = selection.filter((o) => !o.lichessName).map((o) => o.name)
if (sansMatch.length) console.log(`sans correspondance Lichess : ${sansMatch.join(', ')}`)
