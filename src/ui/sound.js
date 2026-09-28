// Sons de l'entraînement (spec docs/reference/contrats.md, section 15.4, chantier X2) :
// synthèse Web Audio pure, sans fichier. Un seul AudioContext partagé, créé au plus tôt à la 1re
// interaction utilisateur de la page (unlock()) : la règle d'autoplay de WebKit suspend tout contexte
// créé plus tôt, il ne jouerait jamais. Respecte le réglage `sounds` (spec 7.5) : chaque appel à
// play() reçoit l'état courant, ce module ne lit et n'écrit jamais lui-même dans le store.
import { invoke } from '@tauri-apps/api/core'

let ctx = null
let unlocked = false
let master = null
let nativeReady = null

async function ready() {
  if (window.__TAURI_INTERNALS__ && navigator.maxTouchPoints > 1) {
    if (!nativeReady) nativeReady = invoke('activate_audio').catch((error) => {
      nativeReady = null
      throw error
    })
    await nativeReady
  }
  const c = ensureContext()
  if (!c) throw new Error('Web Audio indisponible')
  if (c.state !== 'running') await c.resume()
  if (c.state !== 'running') throw new Error(`AudioContext : ${c.state}`)
  return c
}

if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (!document.hidden) nativeReady = null
})

function ensureContext () {
  if (!unlocked) return null // pas encore d'interaction utilisateur : aucun AudioContext créé
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext
    if (!Ctor) return null // navigateur sans Web Audio : silence, jamais bloquant
    try { ctx = new Ctor() } catch { return null }
    ctx.addEventListener?.('statechange', () => {
      if (ctx.state !== 'running') nativeReady = null
    })
    master = ctx.createDynamicsCompressor()
    master.threshold.value = -17
    master.ratio.value = 6
    master.connect(ctx.destination)
  }
  return ctx
}

// unlock() : à appeler depuis un vrai gestionnaire d'interaction utilisateur (coup joué, clic), avant
// tout premier son. Idempotent, ne crée le contexte qu'une fois.
export function unlock () {
  unlocked = true
  const c = ensureContext()
  // WebKit exige que resume() parte pendant le geste, avant l'aller-retour IPC iOS.
  if (c && c.state !== 'running') c.resume().catch(() => {})
}

// Signature « Bois feutré » retenue après écoute sur iPhone : transitoire rond, passe-bas et chute
// courte. Le compresseur partagé limite les crêtes si 2 événements se suivent rapidement.
function woodNote (c, { freq, start = 0, duration = 0.09, gain = 0.12, slide = 0.72 }) {
  const osc = c.createOscillator()
  const filter = c.createBiquadFilter()
  const g = c.createGain()
  osc.type = 'triangle'
  const t0 = c.currentTime + start
  osc.frequency.setValueAtTime(freq, t0)
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t0 + duration)
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(1050, t0)
  filter.frequency.exponentialRampToValueAtTime(420, t0 + duration)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration + 0.09)
  osc.connect(filter).connect(g).connect(master)
  osc.start(t0)
  osc.stop(t0 + duration + 0.11)
}

const SOUNDS = {
  move (c) { woodNote(c, { freq: 210, duration: 0.045, gain: 0.115, slide: 0.68 }) },
  capture (c) {
    woodNote(c, { freq: 168, duration: 0.06, gain: 0.14, slide: 0.55 })
    woodNote(c, { freq: 113, duration: 0.08, gain: 0.09, slide: 0.7, start: 0.045 })
  },
  check (c) {
    woodNote(c, { freq: 311, duration: 0.1, gain: 0.1, slide: 1.13 })
    woodNote(c, { freq: 391, duration: 0.12, gain: 0.08, slide: 1.04, start: 0.1 })
  },
  error (c) {
    woodNote(c, { freq: 189, duration: 0.12, gain: 0.085, slide: 0.62 })
    woodNote(c, { freq: 137, duration: 0.11, gain: 0.06, slide: 0.8, start: 0.09 })
  },
  success (c) {
    ;[210, 264.6].forEach((freq, i) => woodNote(c, { freq, duration: 0.13, gain: 0.095, start: i * 0.095, slide: 1 }))
  },
  perfect (c) {
    ;[210, 264.6, 315, 420].forEach((freq, i) => woodNote(c, { freq, duration: i === 3 ? 0.36 : 0.13, gain: i === 3 ? 0.105 : 0.09, start: i * 0.115, slide: 1 }))
  },
  // Jeu (spec V2 L10) : palier de combo (plus aigu à mesure que le combo monte), défi relevé, trophée,
  // coffre, passage de niveau, secondes finales et fin du Rush.
  combo (c, { level = 5 } = {}) {
    const base = 250 * Math.pow(2, Math.min(level, 60) / 120)
    woodNote(c, { freq: base, duration: 0.08, gain: 0.09, slide: 1 })
    woodNote(c, { freq: base * 1.5, duration: 0.12, gain: 0.07, start: 0.06, slide: 1 })
  },
  quest (c) {
    ;[264.6, 352].forEach((freq, i) => woodNote(c, { freq, duration: 0.14, gain: 0.09, start: i * 0.1, slide: 1 }))
  },
  achievement (c) {
    ;[315, 396.9, 472.5, 630].forEach((freq, i) => woodNote(c, { freq, duration: 0.18, gain: 0.08, start: i * 0.08, slide: 1 }))
  },
  chest (c) {
    woodNote(c, { freq: 160, duration: 0.25, gain: 0.09, slide: 1.6 })
    ;[315, 396.9, 472.5].forEach((freq, i) => woodNote(c, { freq, duration: 0.2, gain: 0.08, start: 0.28 + i * 0.07, slide: 1 }))
  },
  levelup (c) {
    ;[210, 264.6, 315, 420, 529.2].forEach((freq, i) => woodNote(c, { freq, duration: i === 4 ? 0.48 : 0.16, gain: 0.09, start: i * 0.1, slide: 1 }))
  },
  tick (c) { woodNote(c, { freq: 520, duration: 0.03, gain: 0.035, slide: 0.9 }) },
  rushEnd (c) {
    ;[315, 264.6, 210].forEach((freq, i) => woodNote(c, { freq, duration: 0.16, gain: 0.08, start: i * 0.1, slide: 1 }))
  },
}

// play(kind, { sounds }) : joue le son `kind` ('move' | 'capture' | 'check' | 'error' | 'success') si
// `sounds` (réglage utilisateur, par défaut activé) n'est pas explicitement coupé, et si unlock() a
// déjà été appelé. Ne lève jamais : contexte absent, navigateur sans Web Audio, réglage coupé, son
// inconnu -> silence, jamais bloquant pour l'entraînement.
export async function play (kind, { sounds = true, ...opts } = {}) {
  if (!sounds) return
  const fn = SOUNDS[kind]
  if (!fn) return
  try { fn(await ready(), opts) } catch { /* Le jeu reste jouable si la sortie audio échoue. */ }
}

// test() : son de test (bouton "Tester le son" des réglages, spec 15.4). Appelle unlock() lui-même :
// un clic sur ce bouton EST l'interaction utilisateur qui déverrouille le contexte pour tout le reste
// de la session. Ignore le réglage `sounds` (on veut l'entendre même réglage coupé, pour le remettre
// en confiance avant de le réactiver). Rend l'AudioContext utilisé (ou null), pour qu'un smoke test
// puisse vérifier qu'un contexte a bien été créé.
export async function test () {
  unlock()
  let timer
  const c = await Promise.race([
    ready(),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('AudioContext : reprise trop longue')), 5000) }),
  ]).finally(() => clearTimeout(timer))
  SOUNDS.perfect(c)
  return c
}
