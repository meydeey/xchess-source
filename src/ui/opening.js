// Fiche d'une ouverture (spec section 7.2) : coups qui la définissent, difficulté, barres
// victoires/nulles/défaites par tranche, nombre de lignes, ma progression, et les 4 actions. La
// génération locale de l'arbre (catalogue complet ou sélection pas encore générée, section 5 "mode
// app", critère 10.4) vit dans generate.js ; cette fiche se contente de l'afficher.
import { selection, openings, stats, canonicalOpeningId, catalogMeta } from '../data.js'
import { statusOf } from '../core/srs.js'
import { openingMemory } from '../core/game.js'
import { platform } from '../platform/index.js'
import { runGeneration, mountGeneratePanel } from './generate.js'
import {
  resolveOpening,
  getCachedLines,
  BAND_ORDER,
  difficultyOf,
  escapeHtml,
} from './shared.js'
import '../opening-complexity.css'

// Point d'accroche pour la génération locale de l'arbre : garde le nom et la signature historiques
// (opening, { band, onProgress }) ; la génération réelle (moteur, tranche, paramètres, persistance)
// vit dans generate.js (runGeneration), pour rester la même quel que soit l'appelant (cette fiche ou
// mountGeneratePanel). Rend { ok:false, reason:'no-engine' } tant qu'aucun moteur n'est disponible
// (web, ou Tauri avant que le sidecar Stockfish soit branché), jamais une exception.
export async function onGenerate(opening, { band, onProgress } = {}) {
  return runGeneration(opening, { band, onProgress })
}

function segmentsOf(bandRec, side) {
  if (!bandRec) return null
  const win = side === 'black' ? bandRec.black : bandRec.white
  const loss = side === 'black' ? bandRec.white : bandRec.black
  return { games: bandRec.games, win, draw: bandRec.draws, loss }
}
function openingDifficulty(value, t, loading = false) {
  if (value == null) return `<span class="opening-difficulty-value">${t(loading ? 'opening.difficultyLoading' : 'opening.difficultyEmpty')}</span>`
  return `
    <div class="opening-difficulty-value">
      <strong>${t(`opening.difficulty.${value}`)}</strong>
      <span class="opening-difficulty-score">${t('opening.difficultyScore', { value })}</span>
      <span class="opening-difficulty-meter" aria-hidden="true">
        ${Array.from({ length: 5 }, (_, index) => `<i${index < value ? ' class="filled"' : ''}></i>`).join('')}
      </span>
    </div>
  `
}

function wdlResults(seg, t, number) {
  if (!seg?.games) return `<p class="wdl-empty">${t('opening.wdlEmpty')}</p>`
  const pct = (n) => `${(n / seg.games) * 100}%`
  const counts = Object.fromEntries(Object.entries(seg).map(([key, value]) => [key, number.format(value)]))
  return `
    <div class="wdl-bar" aria-hidden="true">
      <span class="seg win" style="width:${pct(seg.win)}"></span>
      <span class="seg draw" style="width:${pct(seg.draw)}"></span>
      <span class="seg loss" style="width:${pct(seg.loss)}"></span>
    </div>
    <p class="wdl-label">${t('opening.wdlTitle', counts)}</p>
  `
}

export async function mount(host, ctx) {
  const { params, state, saveRepertoire, band, navigate, notify, game, t } = ctx
  const locale = state.settings.locale
  const formatPercent = (value) => value == null ? '-' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  const number = new Intl.NumberFormat(locale)
  const opening = resolveOpening(params.id, { selection, openings })
  if (!opening) {
    host.innerHTML = `<p class="empty">${t('opening.missing')} <a href="#/library">${t('opening.back')}</a>.</p>`
    return { destroy() {} }
  }
  const openingName = locale === 'fr' ? opening.name : opening.lichessName || opening.name
  const openingId = canonicalOpeningId(opening.id)
  const indexedDifficulty = catalogMeta(opening.id)?.difficulty
  const inRepertoire = () => state.repertoire.includes(openingId)

  host.innerHTML = `
    <p class="eyebrow"><a class="opening-library" href="#/library">${t('library.title')}</a> · ${opening.eco ? `${opening.eco} · ` : ''}${t(`side.${opening.side}`)}${opening.family ? ` · ${t(`family.${opening.family}`)}` : ''}</p>
    <h1>${escapeHtml(openingName)}</h1>
    <p class="thesis mono">${opening.moves.map((m, i) => `${i % 2 === 0 ? `${i / 2 + 1}.` : ''}${m}`).join(' ')}</p>
    <div class="opening-difficulty">
      <span class="opening-difficulty-label">${t('opening.difficulty')}</span>
      <div class="opening-difficulty-body" role="status">${openingDifficulty(indexedDifficulty, t, true)}</div>
    </div>
    ${game?.pickOfDay() === openingId ? `<p class="pick-note"><span class="badge-x2 mono">XP ×2</span> ${t('opening.pick')}</p>` : ''}
    <div class="fiche-actions">
      <button type="button" class="btn-train primary" disabled>${t('opening.train')}</button>
      <button type="button" class="btn-explore" disabled>${t('opening.explore')}</button>
      <button type="button" class="btn-repertoire"></button>
      <button type="button" class="btn-generate" hidden>${t('opening.generate')}</button>
    </div>
    <div class="generate-host" hidden></div>
    <p class="lines-line"></p>
    <section class="wdl-section"></section>
  `
  const difficultyBody = host.querySelector('.opening-difficulty-body')
  const linesLine = host.querySelector('.lines-line')
  const wdlSection = host.querySelector('.wdl-section')
  const generateBtn = host.querySelector('.btn-generate')
  const generateHost = host.querySelector('.generate-host')
  let activePanel = null
  if (history.state?.fromLibrary) {
    host.querySelector('.opening-library').addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      history.back()
    })
  }

  const repertoireBtn = host.querySelector('.btn-repertoire')
  const renderRepertoireBtn = () => {
    repertoireBtn.textContent = t(inRepertoire() ? 'opening.remove' : 'opening.add')
  }
  renderRepertoireBtn()
  // S'entraîner ajoute l'ouverture au répertoire (spec V2, L0 point 4), avec un message qui permet
  // d'annuler ; Ajouter/Retirer relit l'état à chaque clic, jamais une valeur figée au montage.
  host.querySelector('.btn-train').addEventListener('click', () => {
    if (!inRepertoire()) {
      saveRepertoire([...state.repertoire, openingId])
      notify(t('opening.added', { name: openingName }), {
        actionLabel: t('opening.undo'),
        onAction: () => saveRepertoire(state.repertoire.filter((id) => id !== openingId)),
      })
    }
    navigate(`#/train/${opening.id}`)
  })
  host.querySelector('.btn-explore').addEventListener('click', () => navigate(`#/train/${opening.id}/explore`))
  repertoireBtn.addEventListener('click', () => {
    const next = inRepertoire()
      ? state.repertoire.filter((id) => id !== openingId)
      : [...state.repertoire, openingId]
    saveRepertoire(next) // met state.repertoire à jour tout de suite, avant l'écriture
    renderRepertoireBtn()
  })

  // Lance le panneau de génération (progression + Annuler, generate.js) et réagit à son issue :
  // succès -> accès direct à l'entraînement (critère 10.4) ; annulation ou échec -> le bouton
  // Générer l'arbre réapparaît, le panneau reste affiché avec son message (feedback clair, jamais
  // d'exception non capturée : runGeneration ne lève jamais).
  function startGeneration() {
    generateBtn.hidden = true
    generateHost.hidden = false
    activePanel = mountGeneratePanel(generateHost, opening, { band, t })
    activePanel.done.then((res) => {
      if (res.ok) { navigate(`#/train/${opening.id}`); return }
      generateBtn.hidden = false
      generateBtn.textContent = t('opening.generate')
    })
  }

  // Barres victoires/nulles/défaites : la sélection a une mesure par tranche (14.3, stats.selection),
  // le catalogue complet n'a qu'un score agrégé pour la tranche débutant (stats.catalog).
  if (opening.tier === 'selection') {
    const bandsStat = stats.selection?.[opening.id]?.bands ?? {}
    wdlSection.innerHTML = `
      <div class="opening-rating-control">
        <label for="opening-rating-band">${t('opening.ratingResults')}</label>
        <select id="opening-rating-band" aria-controls="opening-rating-result">
          ${BAND_ORDER.map((b) => `<option value="${b}">${t(`band.${b}`)}</option>`).join('')}
        </select>
      </div>
      <div id="opening-rating-result" class="opening-rating-result" role="status"></div>
    `
    const rating = wdlSection.querySelector('select')
    const results = wdlSection.querySelector('.opening-rating-result')
    rating.value = BAND_ORDER.includes(band) ? band : BAND_ORDER[0]
    const renderResults = () => {
      results.innerHTML = wdlResults(segmentsOf(bandsStat[rating.value], opening.side), t, number)
    }
    rating.addEventListener('change', renderResults)
    renderResults()
  } else {
    const catStat = stats.catalog?.[opening.id]
    wdlSection.innerHTML = catStat
      ? `<p class="wdl-label">${t('opening.catalogScore', { score: formatPercent(catStat.scoreLow), games: number.format(catStat.games) })}</p>`
      : `<p class="wdl-empty">${t('opening.catalogEmpty')}</p>`
  }

  const { lines, header, unavailable } = await getCachedLines(opening)
  linesLine.textContent = lines.length
    ? t('opening.lines', { count: lines.length })
    : unavailable
      ? t('opening.offline')
      : t('opening.noTree')
  host.querySelector('.btn-train').disabled = lines.length === 0
  host.querySelector('.btn-explore').disabled = lines.length === 0

  // Bouton Générer l'arbre : seulement sur une fiche sans arbre (sélection pas encore générée
  // localement, section 5 "mode app" ; le catalogue complet est développé d'avance, ADR-0006). Une
  // fois l'arbre présent, la génération n'a plus d'objet et le bouton reste caché.
  if (!lines.length && !unavailable) {
    generateBtn.hidden = false
    if (platform.engine) {
      generateBtn.disabled = false
      generateBtn.title = t('opening.generateTitle')
      generateBtn.addEventListener('click', startGeneration)
    } else {
      generateBtn.disabled = true
      generateBtn.textContent = t('opening.engineUnavailable')
    }
  }

  // Charge d’apprentissage (D9, ADR-0005) : la même fonction que la Bibliothèque.
  const difficulty = difficultyOf(header) ?? indexedDifficulty
  if (difficulty !== indexedDifficulty || difficulty == null) difficultyBody.innerHTML = openingDifficulty(difficulty, t)

  if (lines.length) {
    const p = state.progress[openingId] || {}
    const mastered = lines.filter((l) => statusOf(p, l.id) === 'mastered').length
    linesLine.textContent += ` ${t('opening.progress', { mastered, total: lines.length })}`
    const m = openingMemory(lines, p)
    if (m) linesLine.textContent += ` ${t('opening.memory', { value: formatPercent(m.memory) })}`
  }

  return {
    destroy() {
      // Un seul moteur Stockfish côté app : ne jamais laisser une génération tourner après avoir
      // quitté la fiche (navigation vers un autre écran qui utiliserait aussi platform.engine).
      activePanel?.destroy()
    },
  }
}
