export const RABBITS = [
  { id: 'origin', chapter: null },
  { id: 'explorer', chapter: 'club' },
  { id: 'code', chapter: 'tournament', practice: { category: 'tactics', count: 30 } },
  { id: 'twilight', chapter: 'beyond' },
  { id: 'egyptian', practice: { category: 'technique', count: 10 } },
  { id: 'candy', practice: { category: 'all', count: 5 } },
  { id: 'horror', practice: { category: 'attack', count: 10 } },
]
export const BOARD_THEMES = [
  { id: 'current', chapter: null },
  { id: 'club', chapter: null },
  { id: 'burrow', chapter: 'club' },
  { id: 'code', chapter: 'tournament' },
  { id: 'passage', chapter: 'beyond' },
]
// One expression edit remains unavailable from the image service. Keep their idle art usable.
export const PENDING_RABBIT_ART = ['code-encouragement']
export const RABBIT_POSES = ['idle', 'blink', 'thinking', 'joy', 'surprise', 'encouragement', 'victory']

// The campaign supplies completed chapter IDs, never cosmetic settings or preview URLs.
export function collectionFor(completedChapters = [], { attempts = [] } = {}) {
  const completed = new Set(completedChapters)
  const successes = attempts.filter((attempt) => attempt.result === 'solved' && typeof (attempt.ref || attempt.id) === 'string')
  const progress = {}
  for (const category of ['all', 'tactics', 'technique', 'attack']) {
    progress[category] = new Set(successes.filter((attempt) => category === 'all' || attempt.cat === category || attempt.mode === category || category === 'attack' && typeof attempt.mode === 'string' && attempt.mode.startsWith('mate1')).map((attempt) => attempt.ref || attempt.id)).size
  }
  return {
    rabbits: RABBITS.filter((item) => !item.chapter && !item.practice || completed.has(item.chapter) || item.practice && progress[item.practice.category] >= item.practice.count).map((item) => item.id),
    boards: BOARD_THEMES.filter((item) => !item.chapter || completed.has(item.chapter)).map((item) => item.id),
    progress,
  }
}

export function appearanceState(settings = {}, collection = collectionFor()) {
  return {
    rabbit: RABBITS.some((item) => item.id === settings.rabbitOutfit) && collection.rabbits.includes(settings.rabbitOutfit) ? settings.rabbitOutfit : 'origin',
    board: BOARD_THEMES.some((item) => item.id === settings.boardTheme) && collection.boards.includes(settings.boardTheme) ? settings.boardTheme : 'current',
    visible: settings.companionVisible !== false,
    comments: settings.companionComments !== false,
    animations: settings.companionAnimations !== false,
  }
}

export function rabbitAsset(rabbit, pose = 'idle') {
  const outfit = RABBITS.some((item) => item.id === rabbit) ? rabbit : 'origin'
  const state = RABBIT_POSES.includes(pose) ? pose : 'idle'
  return `companion/${outfit}-${PENDING_RABBIT_ART.includes(`${outfit}-${state}`) ? 'idle' : state}.png`
}
