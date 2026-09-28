// Point d'entrée : petit routeur par hash (spec section 7), état partagé (réglages, répertoire,
// progression) persisté via platform.store (contrat 14.6), et le bus d'actions clavier / menu natif
// qui relie les raccourcis web et platform.onMenu aux mêmes noms d'action.
import './style.css'
import { platform } from './platform/index.js'
import { createPersister } from './platform/persister.js'
import { eloToBand } from './core/metrics.js'
import { deriveChallengePath } from './core/challenges.js'
import { deriveMastery } from './core/mastery.js'
import { JOURNAL_VERSION, exportJournal, importJournal, makeEvent, mergeEvents, migrationEvents, replayJournal } from './core/journal.js'
import { DEFAULT_SETTINGS, createActionBus } from './ui/shared.js'
import * as today from './ui/today.js'
import * as library from './ui/library.js'
import * as opening from './ui/opening.js'
import * as trainer from './ui/trainer.js'
import * as session from './ui/session.js'
import * as rush from './ui/rush.js'
import * as exercises from './ui/exercises.js'
import * as arena from './ui/arena.js'
import * as games from './ui/games.js'
import * as progress from './ui/progress.js'
import * as settings from './ui/settings.js'
import * as selftest from './ui/selftest.js'
import { createGame, renderChip } from './ui/game.js'
import { deviceLocale, resolveLocale, t } from './i18n.js'

const SCREENS = { today, library, opening, train: trainer, session, rush, exercises, arena, games, progress, settings, selftest }
const view = document.getElementById('view')
const navEl = document.getElementById('nav')
const chipEl = document.getElementById('player-chip')

const state = { settings: DEFAULT_SETTINGS, repertoire: [], progress: {} }
let journalEvents = []
let journalDevice = null
let journalEnabled = false
const actionBus = createActionBus()
let screen = null
let mountToken = 0
let game = null // contrôleur du jeu (src/ui/game.js), créé au démarrage après l'état

// ---------- sauvegarde confirmée (spec V2, L0 point 8) et message temporaire ----------
const saveBanner = document.getElementById('save-banner')
const persister = createPersister({
  set: (key, value) => platform.store.set(key, value),
  onStatus: (ok) => { saveBanner.hidden = ok && !journalPersister.failing },
})
const journalPersister = createPersister({
  set: (_id, event) => platform.journal.append(event),
  onStatus: (ok) => { saveBanner.hidden = ok && !persister.failing },
})
saveBanner.querySelector('button').addEventListener('click', () => persister.retry())
saveBanner.querySelector('button').addEventListener('click', () => journalPersister.retry())

const toastEl = document.getElementById('toast')
const toastText = toastEl.querySelector('.toast-text')
const toastAction = toastEl.querySelector('.toast-action')
let toastTimer = null
// notify(text, { actionLabel, onAction, ms }) : message en bas d'écran, avec un bouton facultatif
// (ex. « Annuler »), qui survit à un changement d'écran et disparaît seul après `ms`.
function notify(text, { actionLabel = null, onAction = null, ms = 6000 } = {}) {
  clearTimeout(toastTimer)
  toastText.textContent = text
  toastAction.hidden = !actionLabel
  toastAction.textContent = actionLabel || ''
  toastAction.onclick = onAction ? () => { toastEl.hidden = true; onAction() } : null
  toastEl.hidden = false
  toastTimer = setTimeout(() => { toastEl.hidden = true }, ms)
}

// ---------- état persistant ----------
async function loadState() {
  const [storedSettings, storedRepertoire, storedProgress, storedActivity, storedPuzzleAttempts] = await Promise.all([
    platform.store.get('settings'),
    platform.store.get('repertoire'),
    platform.store.get('progress'),
    platform.store.get('activity'),
    platform.store.get('puzzleAttempts'),
  ])
  const priorUse = Boolean(storedSettings || storedRepertoire?.length || Object.keys(storedProgress || {}).length || storedActivity?.length || storedPuzzleAttempts?.length)
  const defaults = { ...DEFAULT_SETTINGS, locale: priorUse ? 'fr' : deviceLocale() }
  state.settings = { ...defaults, ...(storedSettings || {}) }
  // Dédoublonné au chargement : l'ancien bouton Ajouter/Retirer pouvait ajouter 2 fois la même ouverture.
  const repertoire = storedRepertoire || []
  state.repertoire = [...new Set(repertoire)]
  state.progress = storedProgress || {}
  try {
    journalDevice = await platform.store.get('journalDevice')
    if (!journalDevice) {
      journalDevice = crypto.randomUUID()
      if (!await platform.store.set('journalDevice', journalDevice)) throw new Error('Identifiant de l’appareil non sauvegardé')
    }
    const existingEvents = await platform.journal.all()
    if (existingEvents.length && !priorUse) {
      defaults.locale = 'fr'
      state.settings.locale = 'fr'
    }
    await platform.journal.appendMany(migrationEvents({
      settings: storedSettings || {}, repertoire: storedRepertoire || [],
      progress: storedProgress || {}, activity: storedActivity || [], puzzleAttempts: storedPuzzleAttempts || [],
    }, journalDevice))
    if (!priorUse && !existingEvents.length) {
      await platform.journal.append(makeEvent('setting', { key: 'locale', value: defaults.locale }, journalDevice))
    }
    journalEvents = await platform.journal.all()
    const replayed = replayJournal(journalEvents, { defaultSettings: defaults })
    state.settings = replayed.settings
    state.repertoire = replayed.repertoire
    state.progress = replayed.progress
    journalEnabled = true
  } catch (error) {
    console.error('Journal indisponible', error)
    saveBanner.hidden = false
    if (state.repertoire.length !== repertoire.length) persister.write('repertoire', state.repertoire)
  }
}
function appendJournal(event) {
  journalEvents = mergeEvents(journalEvents, [event])
  return journalPersister.write(event.id, event)
}
const journalForGame = {
  async allActivity() {
    return replayJournal(journalEvents).activity
  },
  appendActivity(original) {
    const event = {
      id: `activity:${original.id}`, at: original.at, day: original.day,
      device: journalDevice, v: JOURNAL_VERSION, kind: 'activity', data: { event: original },
    }
    return appendJournal(event)
  },
}
// Chaque save* rend true une fois l'écriture confirmée, false si elle reste en attente (bandeau).
async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch }
  if (game) renderChip(chipEl, game.derive(), state.settings.locale)
  if (!journalEnabled) return persister.write('settings', state.settings)
  return (await Promise.all(Object.entries(patch).map(([key, value]) =>
    appendJournal(makeEvent('setting', { key, value }, journalDevice))))).every(Boolean)
}
async function saveRepertoire(next) {
  const previous = new Set(state.repertoire)
  state.repertoire = [...new Set(next)]
  if (!journalEnabled) return persister.write('repertoire', state.repertoire)
  const current = new Set(state.repertoire)
  const changed = [...new Set([...previous, ...current])].filter((id) => previous.has(id) !== current.has(id))
  return (await Promise.all(changed.map((openingId) =>
    appendJournal(makeEvent('repertoire', { openingId, present: current.has(openingId) }, journalDevice))))).every(Boolean)
}
async function saveProgress(openingId, nextSub) {
  const previous = state.progress[openingId] || {}
  state.progress = { ...state.progress, [openingId]: nextSub }
  if (!journalEnabled) return persister.write('progress', state.progress)
  const changed = Object.entries(nextSub).filter(([id, entry]) => JSON.stringify(previous[id]) !== JSON.stringify(entry))
  return (await Promise.all(changed.map(([lineId, entry]) =>
    appendJournal(makeEvent('line', {
      openingId, lineId, entry,
      runsDelta: Math.max(0, (entry.runs || 0) - (previous[lineId]?.runs || 0)),
      flawlessDelta: Math.max(0, (entry.flawless || 0) - (previous[lineId]?.flawless || 0)),
    }, journalDevice))))).every(Boolean)
}
async function resetAllProgress() {
  state.progress = {}
  if (!journalEnabled) return persister.write('progress', state.progress)
  return appendJournal(makeEvent('reset', { scope: 'progress' }, journalDevice))
}
async function downloadBackup() {
  if (!journalEnabled || !await journalPersister.retry()) throw new Error('Sauvegarde indisponible, réessaie après la synchronisation')
  const blob = new Blob([exportJournal(journalEvents)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `xchess-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
async function restoreBackup(file) {
  if (!journalEnabled) throw new Error('Journal indisponible sur cet appareil')
  const merged = importJournal(await file.text(), journalEvents)
  const known = new Set(journalEvents.map((event) => event.id))
  await platform.journal.appendMany(merged.filter((event) => !known.has(event.id)))
  location.reload()
}
async function savePuzzleAttempt({ id, mode, result, errors, ms, rating, cat, aided = false, theme = null, packVersion = null }) {
  const data = { ref: id, mode, result, errors, ms, rating, cat, aided, theme, packVersion }
  if (journalEnabled) return appendJournal(makeEvent('puzzle', data, journalDevice))
  const attempts = (await platform.store.get('puzzleAttempts')) || []
  return persister.write('puzzleAttempts', [...attempts, { ...data, at: Date.now() }])
}
async function getPuzzleAttempts() {
  if (journalEnabled) return journalEvents.filter((event) => event.kind === 'puzzle').map((event) => ({ ...event.data, at: event.at, day: event.day, id: event.id }))
  return (await platform.store.get('puzzleAttempts')) || []
}
function getGameEvents() { return journalEvents.filter((event) => event.kind === 'game' || event.kind === 'drill') }
async function getChallengePath(attempts = null) {
  return deriveChallengePath({ elo: state.settings.elo, source: state.settings.eloSource, attempts: attempts ?? await getPuzzleAttempts(), activity: game.events, journal: getGameEvents() })
}
async function getMastery(attempts = null) {
  return deriveMastery({ puzzles: attempts ?? await getPuzzleAttempts(), activity: game.events })
}
async function saveGameFact(kind, data) {
  if (!journalEnabled) throw new Error('games.journalUnavailable')
  if (!await appendJournal(makeEvent(kind, data, journalDevice))) throw new Error('games.saveError')
}

// ---------- routeur par hash ----------
// Accueil : Aujourd'hui (D6, ADR-0005). #/library[/<onglet>[/<recherche>]] ; #/stats reste un alias
// de l'onglet Statistiques de Progrès.
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'opening' && parts[1]) return { name: 'opening', params: { id: decodeURIComponent(parts[1]) } }
  if (parts[0] === 'train' && parts[1]) return { name: 'train', params: { id: decodeURIComponent(parts[1]), tab: parts[2] || 'train' } }
  if (parts[0] === 'session') return { name: 'session', params: { go: parts[1] === 'go' } }
  if (parts[0] === 'rush') return { name: 'rush', params: {} }
  if (parts[0] === 'exercises') return { name: 'exercises', params: { mode: parts[1] || null, theme: parts[2] || null } }
  if (parts[0] === 'arena') return { name: 'arena', params: {} }
  if (parts[0] === 'games') return { name: 'games', params: { gameId: parts[1] || null } }
  if (parts[0] === 'progress') return { name: 'progress', params: { tab: parts[1] } }
  if (parts[0] === 'stats') return { name: 'progress', params: { tab: 'stats' } }
  if (parts[0] === 'settings') return { name: 'settings', params: {} }
  if (parts[0] === 'selftest') return { name: 'selftest', params: {} } // ouverte uniquement par le Rust, THEORIE_SELFTEST=1
  if (parts[0] === 'library') return { name: 'library', params: { tab: parts[1], q: parts[2] ? decodeURIComponent(parts[2]) : undefined } }
  return { name: 'today', params: {} }
}
function navigate(hash) {
  if (location.hash === hash) { render(); return }
  location.hash = hash
}
function makeCtx(route) {
  return {
    params: route.params,
    state,
    band: eloToBand(state.settings.elo, state.settings.eloSource),
    saveSettings,
    saveRepertoire,
    saveProgress,
    resetAllProgress,
    downloadBackup,
    restoreBackup,
    savePuzzleAttempt,
    getPuzzleAttempts,
    getGameEvents,
    getChallengePath,
    getMastery,
    saveGameFact,
    navigate,
    notify,
    setActions: (handlers) => actionBus.setLocal(handlers),
    game,
    t: (key, values) => t(state.settings.locale, key, values),
  }
}
const NAV_OF = { today: 'today', session: 'today', rush: 'today', library: 'library', opening: 'library', train: 'library', exercises: 'exercises', arena: 'exercises', games: 'progress', progress: 'progress', settings: 'settings' }
function highlightNav(route) {
  const top = NAV_OF[route.name] ?? route.name
  navEl.querySelectorAll('a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.route === top)))
}
function applyShellLocale() {
  const locale = resolveLocale(state.settings.locale)
  document.documentElement.lang = locale
  for (const route of ['today', 'library', 'exercises', 'progress', 'settings']) {
    navEl.querySelectorAll(`[data-route="${route}"] span`).forEach((span) => { span.textContent = t(locale, `nav.${route}`) })
  }
  saveBanner.querySelector('span').textContent = t(locale, 'save.error')
  saveBanner.querySelector('button').textContent = t(locale, 'save.retry')
  document.querySelector('#levelup .eyebrow').textContent = t(locale, 'level.up')
  document.querySelector('#levelup .levelup-close').textContent = t(locale, 'continue')
}
async function render() {
  const route = parseRoute()
  const myToken = ++mountToken
  screen?.destroy?.()
  screen = null
  actionBus.setLocal({})
  // 1 conteneur neuf par montage : un écran encore en chargement (arbres téléchargés à la demande)
  // quand on navigue ailleurs n'écrit plus que dans son conteneur détaché, jamais dans l'écran suivant.
  const root = document.createElement('div')
  root.className = 'screen'
  view.replaceChildren(root)
  applyShellLocale()
  highlightNav(route)
  if (game) renderChip(chipEl, game.derive(), state.settings.locale)
  const mod = SCREENS[route.name]
  const result = await mod.mount(root, makeCtx(route))
  if (myToken !== mountToken) { result?.destroy?.(); return } // une navigation plus récente a eu lieu pendant le montage
  screen = result
}

// ---------- actions : raccourcis web et menu natif (contrat 14.6) partagent les mêmes noms ----------
function dispatchAction(action) {
  if (action === 'library') return navigate('#/library')
  if (action === 'session') return navigate('#/session')
  if (action === 'settings') return navigate('#/settings')
  if (action === 'search') {
    if (parseRoute().name !== 'library') return navigate('#/library')
    return actionBus.dispatch('search')
  }
  actionBus.dispatch(action)
}
const KEY_ACTIONS = { n: 'next', i: 'hint', r: 'restart', '1': 'tab:train', '2': 'tab:explore', '3': 'tab:lines', '/': 'search' }
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
  const tag = e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  const key = e.key.toLowerCase()
  if (key === 'arrowleft') { e.preventDefault(); return actionBus.dispatch('explore:back') }
  if (key === 'arrowright') { e.preventDefault(); return actionBus.dispatch('explore:forward') }
  const action = KEY_ACTIONS[key]
  if (!action) return
  e.preventDefault()
  dispatchAction(action)
})

// ---------- version web installable (iPhone) : hors ligne et stockage durable ----------
// Jamais dans l'app Tauri : elle a son propre store et sert ses fichiers elle-même.
function setupInstallableWeb() {
  if (platform.kind !== 'web') return
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }
  navigator.storage?.persist?.().catch(() => {})
}

// ---------- démarrage ----------
async function boot() {
  setupInstallableWeb()
  await loadState()
  game = createGame({ state, store: platform.store, persister, journal: journalEnabled ? journalForGame : null, navigate })
  await game.load()
  game.subscribe((g) => renderChip(chipEl, g, state.settings.locale))
  renderChip(chipEl, game.state, state.settings.locale)
  window.addEventListener('hashchange', render)
  platform.onMenu((action) => dispatchAction(action))
  render()
}
boot()
