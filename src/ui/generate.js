// Génération locale de l'arbre depuis l'app (spec docs/reference/contrats.md, section 5
// "mode app", 14.5, critère de done 10.4) : Stockfish seul (platform.engine), sans explorateur ni
// études. Module UI (DOM + orchestration), la génération elle-même reste dans src/generator/index.js
// (non modifié). platform/index.js et shared.js (import.meta.glob, contrat Vite) s'importent en
// dynamique dans runGeneration plutôt qu'en tête de fichier : les helpers purs ci-dessous (bandArgFor,
// formatElapsed, APP_GENERATE_PARAMS) restent alors chargeables sous Bun sans Vite, pour
// tests/generate-ui.test.js.
import { generateTree, DEFAULT_PARAMS } from '../generator/index.js'
import { BANDS } from '../core/metrics.js'

// Réglages de l'app, mesurés sous Bun avec EnginePool (tools/lib/uci-engine.mjs, même contrat
// analyse() que le sidecar Tauri, 1 seul moteur et 1 seul thread pour coller au sidecar réel qui ne
// règle jamais Threads : Stockfish y reste sur sa valeur par défaut).
//
// En mode app (explorer null), l'arbre est structurellement borné : la largeur des réponses adverses
// vaut 3 puis 2 puis 1 pour toujours (règle du 14.5), donc au plus 3 x 2 = 6 lignes quelle que soit
// l'ouverture ; mes propres coups ne branchent jamais (myMoveNode choisit un seul coup). Avec
// ownMovesMax = 12 (règle de contenu de la section 5, laissée intacte ici), 2 ouvertures hors
// sélection mesurées le 2026-09-21 :
//   - "Caro-Kann Defense" (id catalogue "caro-kann-defense-2", Blancs après 1...c6, prefix e4 c6 Nc3)
//   - "French Defense" (id catalogue "french-defense", Noirs, prefix e4 e6)
// donnent, quels que soient movetime/depth ci-dessous (la structure ne change pas, seuls les coups
// choisis et les évaluations varient un peu avec la profondeur) : 112 et 123 positions, 6 lignes.
// Temps mesurés (movetime 800 / depth 16, valeurs du mode complet en ligne de commande) : 34,0 s et
// 30,0 s. Avec les valeurs retenues ci-dessous (movetime 400 / depth 14) : 14,6 s et 13,7 s, même
// nombre de positions et de lignes. Le pire cas tient à la structure, pas à la machine : le plafond
// movetime borne le temps de chaque position indépendamment de sa vitesse, donc même si TOUTES les
// positions atteignaient ce plafond (aucune ne l'a fait ici), le temps total resterait de l'ordre de
// positions_max (~170) x movetime (0,4 s) ≈ 68 s, largement sous les 10 minutes du critère 10.4.
// Profondeur 14 plutôt que 16 : à 400 Elo (réglage par défaut de l'app), la théorie choisie par
// Stockfish à ces 2 profondeurs dépasse déjà largement le niveau de l'adversaire ; le gain de vitesse
// (environ 2x sur les 2 mesures) compte plus que les derniers points de profondeur pour une génération
// interactive avec barre de progression.
export const APP_GENERATE_PARAMS = { movetime: 400, depth: 14 }

// { id, ratings } attendu par generateTree (14.5) à partir d'un identifiant de tranche (14.2) ; null
// si la tranche est inconnue ou absente (le générateur traite alors band comme absent).
export function bandArgFor(bandId) {
  const b = bandId && BANDS[bandId]
  return b ? { id: bandId, ratings: b.ratings } : null
}

// Formatage du temps écoulé pour le panneau de progression : "12 s" sous la minute, "1 min 05 s"
// au-delà (aucun cas ne devrait dépasser quelques minutes, voir la mesure ci-dessus).
export function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`
}

// loadExplainTree() : src/explain/index.js (contrat 15.3), écrit par un autre agent en parallèle sur
// ce même chantier. import.meta.glob (comme platform/index.js pour tauri.js, ou data.js pour les
// fichiers du catalogue) plutôt qu'un `import()` dynamique classique : un `import()` sur un chemin
// littéral SURVIT à `bun run build` (vite-plugin-singlefile n'émet qu'un seul fichier, dist/index.html,
// sans le moindre fichier voisin) mais casse ensuite au lancement réel, `../explain/index.js` se
// résolvant alors relativement à dist/ (contrat cassé, vérifié : `Failed to fetch dynamically imported
// module`). import.meta.glob, lui, est un transform Vite au moment du build (comme dans les fichiers
// cités), qui INLINE le module ciblé s'il existe dans le bundle unique - il marche donc pareil en dev,
// en build simple fichier ET dans l'app Tauri, tout en tolérant l'absence du fichier à tout moment
// (glob vide, sans erreur). Placé DANS une fonction (jamais en tête de fichier, où platform/index.js
// tomberait sous Bun) : Vite scanne le fichier entier pour import.meta.glob, où qu'il soit, et
// generate-ui.test.js n'exécute jamais cette fonction sous `bun test` (voir l'en-tête du fichier).
function loadExplainTree() {
  const mods = import.meta.glob('../explain/index.js', { eager: true })
  return mods['../explain/index.js']?.explainTree ?? null
}

// computeAndStoreExplanations(opening, result, ctx) : juste après une génération réussie dans l'app
// (spec 15.3, dernier paragraphe), calcule explainTree avec platform.engine (pas d'explorateur, comme
// generateTree en mode app) et sauvegarde le résultat dans le store `explain:<id>` (format 15.2). Un
// échec ICI (module absent car pas encore écrit, erreur de calcul, annulation) n'annule JAMAIS l'arbre
// déjà sauvegardé par runGeneration : seul un avertissement console le signale, jamais une exception
// qui remonte. `onProgress` n'est volontairement PAS branché sur le payload de progression de l'arbre
// (forme inconnue tant que src/explain/index.js n'existe pas) : ctx.onPhase('explain') affiche un
// indicateur de phase générique (mountGeneratePanel), quelle que soit la forme exacte que prendra le
// onProgress d'explainTree une fois ce module écrit.
async function computeAndStoreExplanations(opening, { tree }, { band, engine, platform, signal, onProgress }) {
  try {
    const explainTree = loadExplainTree()
    if (!explainTree) {
      console.warn("src/explain/index.js indisponible : explications non calculées pour", opening.id)
      return
    }
    const explain = await explainTree(
      { tree, side: opening.side, definingMoves: opening.moves },
      { engine, explorer: null, band: bandArgFor(band), onProgress, signal }
    )
    await platform.store.set(`explain:${opening.id}`, explain)
  } catch (err) {
    console.error("Calcul des explications : échec (l'arbre reste valide)", opening.id, err)
  }
}

// runGeneration(opening, { band, onProgress, onPhase, signal }) -> { ok: true, result } sur succès, ou
// { ok: false, reason: 'no-engine' | 'cancelled' | 'error', error? } sinon. Ne lève jamais : c'est le
// point d'accroche appelé depuis la fiche d'ouverture (onGenerate) et depuis mountGeneratePanel.
// `onPhase('explain' | 'done')` (chantier X2, spec 15.3) : optionnel, prévient l'appelant du passage
// au calcul des explications puis de sa fin, pour afficher une progression même sommaire.
export async function runGeneration(opening, { band, onProgress, onPhase, signal } = {}) {
  const { platform } = await import('../platform/index.js')
  if (!platform.engine) return { ok: false, reason: 'no-engine' }
  try {
    const result = await generateTree(opening, {
      engine: platform.engine,
      explorer: null,
      studies: null,
      band: bandArgFor(band),
      params: { ...DEFAULT_PARAMS, ...APP_GENERATE_PARAMS },
      onProgress,
      signal,
    })
    await platform.store.set(`generated:${opening.id}`, result)
    const { invalidateLineCache } = await import('./shared.js')
    invalidateLineCache(opening.id)
    onPhase?.('explain')
    await computeAndStoreExplanations(opening, result, {
      band,
      engine: platform.engine,
      platform,
      signal,
      onProgress: () => onPhase?.('explain'),
    })
    onPhase?.('done')
    return { ok: true, result }
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, reason: 'cancelled' }
    console.error("Génération de l'arbre : échec", err)
    return { ok: false, reason: 'error', error: err }
  }
}

// mountGeneratePanel(host, opening, { band, t }) : panneau de progression (positions, lignes, temps
// écoulé, aria-live) avec bouton Annuler (AbortController). Rend { done, cancel, destroy } ; `done`
// se résout toujours (jamais de rejet) avec le même format que runGeneration. destroy() annule la
// génération si elle tourne encore, pour ne jamais laisser 2 opérations utiliser platform.engine à la
// fois (le sidecar Stockfish traite une recherche à la fois).
export function mountGeneratePanel(host, opening, { band, t } = {}) {
  const controller = new AbortController()
  const startedAt = Date.now()
  let settled = false

  host.innerHTML = `
    <div class="generate-panel">
      <p class="counts" aria-live="polite">
        <span><b class="gen-positions">0</b> ${t('generate.positions')}</span>
        <span><b class="gen-lines">0</b> ${t('generate.lines')}</span>
        <span><b class="gen-elapsed">0 s</b> ${t('generate.elapsed')}</span>
      </p>
      <p class="gen-phase" aria-live="polite" hidden>${t('generate.explaining')}</p>
      <div class="actions">
        <button type="button" class="btn-cancel-generate">${t('generate.cancel')}</button>
      </div>
      <p class="feedback" data-tone="neutral" hidden></p>
    </div>
  `
  const positionsEl = host.querySelector('.gen-positions')
  const linesEl = host.querySelector('.gen-lines')
  const elapsedEl = host.querySelector('.gen-elapsed')
  const phaseEl = host.querySelector('.gen-phase')
  const cancelBtn = host.querySelector('.btn-cancel-generate')
  const feedbackEl = host.querySelector('.feedback')

  function paintElapsed() {
    elapsedEl.textContent = formatElapsed(Date.now() - startedAt)
  }
  const timer = setInterval(paintElapsed, 500)

  function onProgress({ positions, lines }) {
    positionsEl.textContent = String(positions)
    linesEl.textContent = String(lines)
    paintElapsed()
  }
  // onPhase (chantier X2, spec 15.3) : 'explain' = l'arbre est déjà sauvegardé, le calcul des
  // explications commence (indicateur générique, forme du progrès inconnue tant que
  // src/explain/index.js n'est pas écrit) ; 'done' = les 2 étapes sont terminées (succès ou échec
  // silencieux des explications, l'arbre reste valide dans tous les cas).
  function onPhase(phase) {
    phaseEl.hidden = phase !== 'explain'
    paintElapsed()
  }
  cancelBtn.addEventListener('click', () => controller.abort())

  const done = runGeneration(opening, { band, onProgress, onPhase, signal: controller.signal }).then((res) => {
    settled = true
    clearInterval(timer)
    paintElapsed()
    cancelBtn.disabled = true
    phaseEl.hidden = true
    if (!res.ok) {
      feedbackEl.hidden = false
      if (res.reason === 'cancelled') {
        feedbackEl.dataset.tone = 'neutral'
        feedbackEl.textContent = t('generate.cancelled')
      } else {
        feedbackEl.dataset.tone = 'bad'
        feedbackEl.textContent = res.reason === 'no-engine'
          ? t('generate.noEngine')
          : t('generate.failed')
      }
    }
    return res
  })

  return {
    done,
    cancel: () => controller.abort(),
    destroy() {
      clearInterval(timer)
      if (!settled) controller.abort()
    },
  }
}
