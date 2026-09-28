// Plateforme Tauri : store de progression (@tauri-apps/plugin-store), moteur Stockfish embarqué en
// sidecar (@tauri-apps/plugin-shell, spec 8/14.6), menu natif relayé par l'événement "menu" (émis par
// src-tauri/src/lib.rs). Le process Stockfish est un singleton pour toute la session : chaque appel à
// analyse() ou bestMove() réaffirme explicitement UCI_LimitStrength, UCI_Elo et Skill Level plutôt que
// de compter sur l'état laissé par l'appel précédent (setStrength ci-dessous).
import { Command } from '@tauri-apps/plugin-shell'
import { LazyStore } from '@tauri-apps/plugin-store'
import { listen } from '@tauri-apps/api/event'
import { parseBestMove, createMultiPv } from './uci.js'
import { queuedEngine } from './engine-queue.js'
import { createJournal } from './journal.js'
import { createWorkerProcess } from './wasm.js'

// Plancher de UCI_Elo sur Stockfish 19 : `option name UCI_Elo type spin default 1320 min 1320 max
// 3190` (vérifié sur le binaire embarqué). Sous ce seuil, UCI_Elo ne peut plus représenter la force
// voulue, donc on bride avec Skill Level à la place (contrat 14.6). Skill Level n'a d'effet que si
// UCI_LimitStrength est désactivé : vérifié empiriquement, actif en même temps que UCI_LimitStrength
// il est ignoré, la force vient alors uniquement de UCI_Elo.
export const ELO_FLOOR = 1320

// Skill Level (0 à 19) pour un Elo sous ELO_FLOOR : contrat 14.6.
export function skillLevelFor(elo) {
  return Math.min(19, Math.max(0, Math.round((elo - 400) / 46)))
}

// Profondeur de recherche (1 à 5) pour un Elo sous ELO_FLOOR : contrat 14.6.
export function depthForLowElo(elo) {
  const bounded = Math.min(ELO_FLOOR, Math.max(0, elo))
  return Math.min(5, Math.max(1, Math.round(1 + (bounded / ELO_FLOOR) * 4)))
}

// Délai maximal d'attente d'une ligne UCI avant d'abandonner (spawn/écriture/start/isready/bestmove) :
// généreux par rapport aux temps réels (mesurés sous 1 s, movetime le plus long à 800 ms, section
// 5/14.5, soit une marge de 15 à 20x), pour ne jamais couper une recherche légitime même sur une
// machine chargée, mais borné pour ne jamais bloquer l'app indéfiniment si le canal IPC perd une
// ligne (observé pendant le chantier E4-selftest : le sidecar reste vivant, bloqué en lecture sur
// son entrée standard, faute d'un message jamais délivré côté JS ; cause probable, non confirmée :
// perte occasionnelle d'un message du canal de diffusion stdout de tauri-plugin-shell sous charge
// mémoire système sévère, plus probable avec MultiPV > 1 qui multiplie le débit de lignes "info").
// Sans ce filet, un appelant (generateTree en particulier, qui enchaîne des dizaines d'appels)
// gèlerait l'app pour de bon sur la 1re ligne perdue.
const UCI_WAIT_TIMEOUT_MS = 15000

// Enrobe une promesse Tauri (invoke IPC : spawn, écriture sur stdin) d'un délai maximal : ces appels
// ne rejettent normalement qu'en cas d'erreur explicite, jamais par eux-mêmes s'ils restent sans
// réponse (canal IPC perdu, sidecar mort), donc sans ce filet ils gèleraient l'app pour de bon.
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Stockfish : ${label} sans réponse après ${ms} ms`)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// Comme withTimeout, mais pour command.spawn() spécifiquement : si le spawn répond APRÈS le délai
// (mesuré sous charge mémoire sévère, cf. commentaire de UCI_WAIT_TIMEOUT_MS), la vraie promesse
// aboutit quand même en arrière-plan, avec un process Stockfish réel côté OS. Sans ce suivi, ce
// process n'est jamais assigné à `child` donc jamais killable par l'app : orphelin jusqu'à la
// fermeture complète de l'app. On le tue dès qu'il apparaît plutôt que de le laisser filer, et on ne
// résout/rejette la promesse rendue à l'appelant qu'une seule fois.
export function withTimeoutKillLate(promise, ms, label) {
  let timedOut = false
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true
      reject(new Error(`Stockfish : ${label} sans réponse après ${ms} ms`))
    }, ms)
    promise.then(
      (child) => {
        clearTimeout(timer)
        if (timedOut) child?.kill?.().catch(() => {})
        else resolve(child)
      },
      (err) => { clearTimeout(timer); if (!timedOut) reject(err) },
    )
  })
}

// Connexion bas niveau au process Stockfish : bufferise les lignes du sidecar, diffuse chacune aux
// écouteurs actifs. `command` s'injecte pour les tests (même forme que Command.sidecar : { spawn(),
// stdout: { on(event, fn) } }), un objet de même forme que le retour de cette fonction s'injecte à
// la place dans createEngine() pour les tests.
export function createProcess(command = Command.sidecar('binaries/stockfish')) {
  const listeners = new Set()
  let buffer = ''
  let child = null
  command.stdout.on('data', (chunk) => {
    buffer += chunk
    let i
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim()
      buffer = buffer.slice(i + 1)
      if (line) for (const l of [...listeners]) l(line)
    }
  })

  function send(cmd) {
    if (!child) throw new Error('moteur Stockfish non démarré')
    return withTimeout(child.write(cmd + '\n'), UCI_WAIT_TIMEOUT_MS, `écriture "${cmd}"`)
  }
  function on(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  // N'attend jamais indéfiniment : rejette après UCI_WAIT_TIMEOUT_MS si la ligne attendue n'arrive
  // jamais (canal IPC perdu, sidecar mort ou gelé), pour que l'appelant (analyse/bestMove/start)
  // puisse échouer proprement plutôt que de geler l'app pour de bon.
  function waitFor(pred, timeoutMs = UCI_WAIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      let settled = false
      const off = on((line) => {
        if (pred(line)) {
          settled = true
          off()
          clearTimeout(timer)
          resolve(line)
        }
      })
      const timer = setTimeout(() => {
        if (settled) return
        off()
        reject(new Error(`Stockfish : pas de réponse après ${timeoutMs} ms`))
      }, timeoutMs)
    })
  }
  // N'assigne jamais un process lancé avec succès sans pouvoir le tuer plus tard : si le handshake
  // échoue après un spawn réussi (uciok jamais reçu, cf. le vérificateur adversarial, finding high),
  // ce process serait sinon abandonné vivant à la prochaine tentative (child réassigné par le start()
  // suivant), zombie pour le reste de la session.
  async function start() {
    const spawned = await withTimeoutKillLate(command.spawn(), UCI_WAIT_TIMEOUT_MS, 'lancement du sidecar')
    child = spawned
    try {
      const reply = waitFor((l) => l === 'uciok')
      reply.catch(() => {})
      await send('uci')
      await reply
    } catch (err) {
      try { await spawned.kill() } catch { /* déjà mort */ }
      child = null
      throw err
    }
  }
  async function kill() {
    if (!child) return
    try { await send('quit') } catch { /* déjà arrêté */ }
    try { await child.kill() } catch { /* déjà mort */ }
    child = null
  }
  return { send, on, waitFor, start, kill }
}

// Moteur exposé par platform.engine : { analyse(fen, opts), bestMove(fen, { elo }), dispose() }
// (contrat 14.6). `proc` s'injecte dans les tests pour simuler le sidecar sans lancer Stockfish.
export function createEngine(proc = createProcess()) {
  let ready = null
  // Si start() échoue (timeout, sidecar mort), ne garde pas la promesse rejetée en cache : le
  // prochain appel retente un lancement complet plutôt que d'échouer indéfiniment sur la même erreur.
  function ensureReady() {
    if (!ready) {
      ready = proc.start().catch((err) => {
        ready = null
        throw err
      })
    }
    return ready
  }

  // Un échec APRÈS le handshake initial (setStrength, go, isready... dans setStrength/analyse/
  // bestMove) laisserait sinon `ready` résolu pour toujours : ensureReady() ne relancerait plus
  // jamais proc.start(), et le prochain appel réutiliserait le même sidecar figé, retimeoutant à
  // l'identique (cf. le vérificateur adversarial, finding high : le filet de sécurité par timeout ne
  // rend rien récupérable après le tout premier succès du moteur). On tue le process courant et on
  // réarme `ready` à null pour que le PROCHAIN appel reparte d'un sidecar frais, puis on repropage
  // l'erreur d'origine.
  async function failAndRearm(err) {
    ready = null
    try { await proc.kill() } catch { /* déjà mort */ }
    throw err
  }

  // Réaffirme la force du moteur avant chaque recherche, dans cet ordre : UCI_LimitStrength,
  // UCI_Elo, Skill Level, toujours les 3, jamais un seul. elo absent ou >= ELO_FLOOR : pleine force
  // (UCI_LimitStrength désactivé, Skill Level remis à 20, jamais laissé à une valeur héritée d'un
  // bestMove() bas-Elo précédent) sauf si un elo réel est fourni, alors UCI_Elo le porte à la place.
  // elo < ELO_FLOOR : UCI_LimitStrength désactivé aussi (sinon Skill Level serait ignoré), Skill
  // Level calibré par skillLevelFor.
  // Envoie une commande dont la réponse est attendue, en posant l'écouteur AVANT l'envoi : la
  // réponse du sidecar (readyok, bestmove) peut arriver avant que la promesse d'écriture IPC ne se
  // résolve, surtout sous charge ; écoutée après coup, elle était perdue et l'appel expirait au
  // bout de UCI_WAIT_TIMEOUT_MS (échecs intermittents de la génération d'arbre dans l'app).
  function ask(cmd, pred) {
    let off = () => {}
    let timer = null
    const reply = new Promise((resolve, reject) => {
      off = proc.on((line) => {
        if (!pred(line)) return
        off()
        clearTimeout(timer)
        resolve(line)
      })
      timer = setTimeout(() => {
        off()
        reject(new Error(`Stockfish : pas de réponse après ${UCI_WAIT_TIMEOUT_MS} ms`))
      }, UCI_WAIT_TIMEOUT_MS)
    })
    return proc.send(cmd).then(() => reply, (err) => {
      off()
      clearTimeout(timer)
      throw err
    })
  }

  async function setStrength(elo) {
    const numericElo = typeof elo === 'number' ? elo : null
    const lowElo = numericElo != null && numericElo < ELO_FLOOR
    const limitStrength = numericElo != null && !lowElo
    await proc.send(`setoption name UCI_LimitStrength value ${limitStrength}`)
    await proc.send(`setoption name UCI_Elo value ${limitStrength ? Math.min(3190, Math.max(ELO_FLOOR, Math.round(numericElo))) : ELO_FLOOR}`)
    await proc.send(`setoption name Skill Level value ${lowElo ? skillLevelFor(numericElo) : 20}`)
    await ask('isready', (l) => l === 'readyok')
  }

  // Pleine force, toujours : ignore tout Elo, ne dépend jamais de l'appel précédent (générateur
  // d'arbre en mode app, indices, explorateur).
  async function analyse(fen, { multipv = 1, depth = 16, movetime = 1200, searchmoves = [] } = {}) {
    await ensureReady()
    let off = null
    try {
      await setStrength(null)
      const search = createMultiPv(fen)
      off = proc.on((line) => search.feed(line))
      await proc.send(`setoption name MultiPV value ${multipv}`)
      await proc.send(`position fen ${fen}`)
      const limits = [depth && `depth ${depth}`, movetime && `movetime ${movetime}`].filter(Boolean).join(' ')
      await ask(`go ${limits}${searchmoves.length ? ' searchmoves ' + searchmoves.join(' ') : ''}`, (l) => l.startsWith('bestmove'))
      return search.lines()
    } catch (err) {
      await failAndRearm(err)
    } finally {
      // Toujours désabonné, même sur un échec : sans ce finally, un timeout laissait l'écouteur
      // accroché pour toujours, un de plus par appel raté (cf. le vérificateur adversarial).
      if (off) off()
    }
  }

  // Coup unique, bridé sur elo (section 6, "Continuer contre Stockfish"). elo absent : pleine force.
  async function bestMove(fen, { elo } = {}) {
    await ensureReady()
    try {
      await setStrength(elo)
      await proc.send('setoption name MultiPV value 1')
      await proc.send(`position fen ${fen}`)
      const lowElo = typeof elo === 'number' && elo < ELO_FLOOR
      const line = await ask(lowElo ? `go depth ${depthForLowElo(elo)}` : 'go depth 16 movetime 800', (l) => l.startsWith('bestmove'))
      return parseBestMove(line)?.uci ?? null
    } catch (err) {
      await failAndRearm(err)
    }
  }

  // Réarme aussi `ready` : sans ça, un dispose() suivi d'un nouvel appel réutiliserait la promesse
  // déjà résolue de l'ancien lancement (process tué, jamais relancé) et échouerait sèchement plutôt
  // que de respawn.
  function dispose() {
    ready = null
    return proc.kill()
  }

  return { analyse, bestMove, dispose }
}

const store = new LazyStore('theorie.json')

async function get(key) {
  try {
    const value = await store.get(key)
    return value === undefined ? null : value
  } catch {
    return null // store indisponible (permission refusée, disque plein, contexte non-Tauri)
  }
}
// Réussie seulement une fois le fichier écrit (spec V2, L0 point 8) : store.set ne modifie que la
// mémoire, l'écriture différée sur disque pouvait échouer après un succès affiché.
async function set(key, value) {
  try {
    await store.set(key, value)
    await store.save()
    return true
  } catch {
    return false
  }
}

// Relaie l'événement "menu" émis par le Rust (src-tauri/src/lib.rs) ; rend une fonction de
// désabonnement synchrone même si listen() est asynchrone (même contrat que web.js).
function onMenu(callback) {
  let unlisten = null
  let cancelled = false
  listen('menu', (event) => callback(event.payload)).then((fn) => {
    if (cancelled) fn()
    else unlisten = fn
  })
  return () => {
    cancelled = true
    if (unlisten) unlisten()
  }
}

// Un seul sidecar pour toute l'app : ses recherches passent par la file (engine-queue.js), sans quoi
// les analyses parallèles d'explainTree recevaient les lignes d'une autre position.
export const platform = {
  kind: 'tauri',
  store: { get, set },
  journal: createJournal(),
  engine: queuedEngine(/iPhone|iPad|iPod/.test(navigator.userAgent) ? createEngine(createWorkerProcess()) : createEngine()),
  onMenu,
}
