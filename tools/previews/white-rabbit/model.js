export const styles = [
  { id: 'illustration', name: 'Illustration 2D', summary: 'Traits d’encre et expressions dessinées.' },
  { id: 'figurine', name: 'Figurine 3D', summary: 'Volumes doux et matière tangible.' },
  { id: 'pixel', name: 'Pixel art', summary: 'Contours découpés et présence de jeu.' },
]

export const outfits = [
  { id: 'origin', name: 'Origine', note: 'Le lapin blanc, disponible dès le départ.' },
  { id: 'explorer', name: 'Explorateur', note: 'Gilet et montre, récompense du chapitre 1.' },
  { id: 'code', name: 'Code', note: 'Veste sombre et accents verts, récompense du chapitre 2.' },
  { id: 'twilight', name: 'Crépuscule', note: 'Gris perle et bleu nuit, récompense du chapitre 3.' },
]

export const boards = [
  { id: 'current', name: 'Actuel', note: 'La référence XChess, disponible dès le départ.' },
  { id: 'club', name: 'Club', note: 'Bois chaud, noyer et laiton. Disponible dès le départ.' },
  { id: 'burrow', name: 'Terrier', note: 'Ivoire, encre et chemins gravés. Récompense du chapitre 1.' },
  { id: 'code', name: 'Code', note: 'Graphite, sauge et circuits discrets. Récompense du chapitre 2.' },
  { id: 'passage', name: 'Passage', note: 'Pierre claire, ardoise et reflets nocturnes. Récompense du chapitre 3.' },
]

export const reactions = [
  { id: 'waiting', name: 'Attente', title: 'À toi de jouer', text: 'Je te laisse regarder. On a le temps.', mark: '…' },
  { id: 'good', name: 'Bon coup', title: 'Coup trouvé', text: 'Bien vu ! On garde cette idée pour la suite.', mark: '✓' },
  { id: 'error', name: 'Erreur', title: 'Un autre essai', text: 'On reprend la position. Tu peux essayer une autre idée.', mark: '↻' },
  { id: 'hint', name: 'Indice', title: 'Aide demandée', text: 'Regarde les cases que ton cavalier pourrait attaquer.', mark: '?' },
  { id: 'victory', name: 'Victoire', title: 'Rencontre gagnée', text: 'Cette porte s’ouvre. Tu viens voir ce qu’il y a derrière ?', mark: '✦' },
]

export const devices = [
  { id: 'phone', name: 'Téléphone', width: 390, height: 844 },
  { id: 'tablet-portrait', name: 'Tablette portrait', width: 820, height: 1180 },
  { id: 'tablet-landscape', name: 'Tablette paysage', width: 1180, height: 820 },
]

export const defaultChoice = { style: 'illustration', outfit: 'origin', board: 'club', reaction: 'waiting', device: 'phone', motion: true, baseline: false }
const enums = { style: styles, outfit: outfits, board: boards, reaction: reactions, device: devices }

// A shared preview URL is untrusted input. Only known IDs reach markup or asset URLs.
export function choiceFrom(params) {
  const choice = { ...defaultChoice }
  for (const [key, options] of Object.entries(enums)) {
    const value = params.get(key)
    if (options.some((option) => option.id === value)) choice[key] = value
  }
  for (const key of ['motion', 'baseline']) {
    if (params.has(key)) choice[key] = params.get(key) === '1'
  }
  return choice
}

export function choiceParams(choice) {
  return new URLSearchParams(Object.entries(choice).map(([key, value]) => [key, typeof value === 'boolean' ? value ? '1' : '0' : value]))
}

export function rabbitUrl(choice) {
  return new URL(`./assets/${choice.style}-${choice.outfit}.png`, import.meta.url).href
}
