// Auto-test natif (docs/reference/contrats.md, section 10 et contrat 14, chantier
// E4-selftest). Ce module ne s'exécute jamais de lui-même : il n'est monté que via la route
// #/selftest, ouverte uniquement par le Rust (src-tauri/src/lib.rs) quand la variable d'environnement
// THEORIE_SELFTEST=1 est présente au lancement du process. Sans cette variable, le Rust ne navigue
// jamais vers cette route et ce module ne tourne donc jamais.
//
// N'utilise jamais les vraies clés du store (progress, settings, repertoire, generated:<id>) :
// uniquement des clés préfixées selftest:*, nettoyées au fil de l'exécution. Le résultat final vit
// dans la clé report d'un fichier à part, selftest.json (~/Library/Application
// Support/com.meydeey.theorie/), lisible une fois l'app fermée : il reste écrit même quand
// theorie.json est en lecture seule, cas que l'auto-test sert justement à prouver (spec V2, L0 point 8).
import { emit } from '@tauri-apps/api/event'
import { LazyStore } from '@tauri-apps/plugin-store'
import { platform } from '../platform/index.js'
import { openings } from '../data.js'
import { generateTree, DEFAULT_PARAMS } from '../generator/index.js'
import { APP_GENERATE_PARAMS, bandArgFor } from './generate.js'

const ROUNDTRIP_KEY = 'selftest:roundtrip'
const PERSIST_KEY = 'selftest:persist'
const REPORT_KEY = 'report'

// Position connue après 1.e4, trait aux Noirs (mêmes conventions que tests/uci.test.js).
const KNOWN_FEN = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

// Ouverture du catalogue complet hors sélection : aucun catalog/trees/french-defense.json au
// 2026-09-21 (calcul de nuit en cours sur la sélection), donc forcément générée dans l'app. Déjà
// mesurée au chantier E1-generation avec ces mêmes APP_GENERATE_PARAMS : ~14 s, 123 positions, 6
// lignes, sous les 10 minutes du critère 10.4.
const SELFTEST_OPENING_ID = 'french-defense'

// Aller-retour sur une clé jetable, jamais une vraie clé du store (critère 1). `written` = ce que
// set() a rendu : true seulement si le fichier a été écrit sur disque (false si theorie.json est en
// lecture seule), la valeur restant lisible en mémoire dans les 2 cas.
async function testStoreRoundtrip() {
  const value = { at: Date.now(), n: Math.random() }
  const written = await platform.store.set(ROUNDTRIP_KEY, value)
  const read = await platform.store.get(ROUNDTRIP_KEY)
  await platform.store.set(ROUNDTRIP_KEY, null)
  return { ok: !!read && read.at === value.at && read.n === value.n, written }
}

// Persistance entre 2 lancements : le 1er lancement ne trouve rien et écrit selftest:persist : le
// 2e la retrouve, la rapporte puis la nettoie.
async function testPersistence() {
  const previous = await platform.store.get(PERSIST_KEY)
  if (previous == null) {
    const token = Math.random().toString(36).slice(2)
    await platform.store.set(PERSIST_KEY, { token, writtenAt: Date.now() })
    return { ok: true, phase: 'ecriture', token }
  }
  await platform.store.set(PERSIST_KEY, null)
  return { ok: typeof previous.token === 'string' && previous.token.length > 0, phase: 'lecture', token: previous.token }
}

// analyse() sur une position connue, bestMove() à 400 et à 1500 Elo (les 2 côtés du plancher
// ELO_FLOOR de tauri.js, contrat 14.6).
async function testEngine() {
  if (!platform.engine) return { ok: false, error: 'platform.engine est null' }
  const lines = await platform.engine.analyse(KNOWN_FEN, { multipv: 1, depth: 12, movetime: 400 })
  const best400 = await platform.engine.bestMove(KNOWN_FEN, { elo: 400 })
  const best1500 = await platform.engine.bestMove(KNOWN_FEN, { elo: 1500 })
  return {
    ok: Array.isArray(lines) && lines.length > 0 && typeof lines[0]?.uci === 'string'
      && typeof best400 === 'string' && typeof best1500 === 'string',
    analyse: lines?.[0] ?? null,
    best400,
    best1500,
  }
}

// generateTree en mode app (explorer null), mêmes paramètres que src/ui/opening.js (via
// src/ui/generate.js, APP_GENERATE_PARAMS), sur l'ouverture hors sélection ci-dessus, durée mesurée
// (critère 10.4 : moins de 10 minutes).
async function testGeneration() {
  if (!platform.engine) return { ok: false, error: 'platform.engine est null' }
  const opening = openings.find((o) => o.id === SELFTEST_OPENING_ID)
  if (!opening) return { ok: false, error: `ouverture ${SELFTEST_OPENING_ID} absente du catalogue complet` }
  const startedAt = Date.now()
  const { tree, header } = await generateTree(opening, {
    engine: platform.engine,
    explorer: null,
    studies: null,
    band: bandArgFor('debutant'),
    params: { ...DEFAULT_PARAMS, ...APP_GENERATE_PARAMS },
  })
  return {
    ok: !!tree,
    durationMs: Date.now() - startedAt,
    positions: header?.metrics?.positions ?? null,
    lines: header?.metrics?.lines ?? null,
  }
}

// Arrête Stockfish puis demande au Rust de quitter (événement "selftest:quit", écouté dans
// src-tauri/src/lib.rs). Ne lève jamais : c'est la dernière étape, rien ne doit l'empêcher.
async function requestQuit() {
  try { await platform.engine?.dispose() } catch { /* déjà arrêté */ }
  if (platform.kind === 'tauri') {
    try { await emit('selftest:quit') } catch { /* rien de plus à faire si l'émission échoue */ }
  }
}

// runSelftest(onLine) exécute toute la séquence des critères de la section 10, jamais d'exception
// qui remonte : un rapport est toujours écrit dans selftest:report et la sortie toujours demandée,
// même si une étape échoue en cours de route.
export async function runSelftest(onLine = () => {}) {
  const report = { at: new Date().toISOString() }
  try {
    onLine('Store : aller-retour sur selftest:roundtrip…')
    report.roundtrip = await testStoreRoundtrip()
    onLine(`  -> ${report.roundtrip.ok ? 'ok' : 'échec'}, écrit sur disque : ${report.roundtrip.written ? 'oui' : 'non'}`)

    onLine('Store : persistance sur selftest:persist…')
    report.persistence = await testPersistence()
    onLine(`  -> ${report.persistence.phase} (${report.persistence.ok ? 'ok' : 'échec'})`)

    onLine('Moteur : analyse() + bestMove() à 400 et 1500 Elo…')
    report.engine = await testEngine()
    onLine(`  -> ${report.engine.ok ? 'ok' : 'échec'}`)

    onLine(`Génération : ${SELFTEST_OPENING_ID} en mode app…`)
    report.generation = await testGeneration()
    onLine(`  -> ${report.generation.ok ? 'ok' : 'échec'} en ${report.generation.durationMs} ms`)
  } catch (err) {
    report.error = err?.message || String(err)
    onLine(`Erreur inattendue : ${report.error}`)
  }
  try {
    const reportStore = new LazyStore('selftest.json')
    await reportStore.set(REPORT_KEY, report)
    await reportStore.save()
  } catch (err) {
    onLine(`Rapport non écrit : ${err?.message || err}`)
  }
  onLine('Rapport écrit dans selftest.json. Arrêt du moteur puis sortie…')
  await requestQuit()
  return report
}

export async function mount(host) {
  host.innerHTML = `
    <p class="eyebrow">Diagnostic</p>
    <h1>Auto-test natif</h1>
    <pre class="selftest-log mono" aria-live="polite" style="white-space:pre-wrap; font-size:12.5px;"></pre>
  `
  const logEl = host.querySelector('.selftest-log')
  let destroyed = false
  const append = (line) => {
    if (destroyed) return
    logEl.textContent += (logEl.textContent ? '\n' : '') + line
  }
  runSelftest(append)
  return { destroy() { destroyed = true } }
}
