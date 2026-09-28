// Session du jour (spec section 7.4) : les lignes dues de tout le répertoire, ratées d'abord, puis
// les nouvelles jusqu'au plafond quotidien. Rejoue le plateau de trainer.js (mountLineDrill) ligne
// après ligne, à travers plusieurs ouvertures si besoin : c'est la seule différence avec l'écran
// d'entraînement d'une ouverture, qui lui reste dans une seule ouverture.
import { selection, openings } from '../data.js'
import { buildSession } from '../core/session.js'
import { statusOf, recordRun } from '../core/srs.js'
import { phasesFor, knownPrefixLength } from '../core/learn.js'
import { introducedTodayCount } from '../core/stats.js'
import { mountLineDrill, getExplanations, verdictText } from './trainer.js'
import { lineEnding } from '../core/lines.js'
import * as sound from './sound.js'
import { resolveOpening, getCachedLines, difficultyOf } from './shared.js'
import { mountHud } from './game.js'
import { eloToBand } from '../core/metrics.js'

export async function mount(host, ctx) {
  const { state, saveProgress, setActions, game, t, params = {} } = ctx
  host.innerHTML = `
    <p class="eyebrow"><a href="#/">${t('today')}</a> · ${t('session.title')}</p>
    <h1 class="session-opening">${t('session.title')}</h1>
    <p class="session-summary">${t('session.preparing')}</p>
    <p class="session-difficulty" hidden></p>
    <div class="session-body"></div>
  `
  const openingEl = host.querySelector('.session-opening')
  const summaryEl = host.querySelector('.session-summary')
  const difficultyEl = host.querySelector('.session-difficulty')
  const bodyEl = host.querySelector('.session-body')

  if (!state.repertoire.length) {
    summaryEl.textContent = t('session.empty')
    setActions({})
    return { destroy() {} }
  }

  const linesByOpening = {}
  const explainByOpening = {}
  const difficultyByOpening = {}
  for (const openingId of state.repertoire) {
    const opening = resolveOpening(openingId, { selection, openings })
    const [{ lines, header }, explainData] = await Promise.all([getCachedLines(opening), getExplanations(openingId)])
    linesByOpening[openingId] = lines
    explainByOpening[openingId] = explainData
    difficultyByOpening[openingId] = difficultyOf(header)
  }
  const now = Date.now()
  const introducedToday = introducedTodayCount(state.progress, state.repertoire, now)
  const session = buildSession({
    repertoire: state.repertoire,
    linesByOpening,
    progress: state.progress,
    now,
    newPerDay: state.settings.newPerDay,
    introducedToday,
  })

  if (session.total) summaryEl.textContent = t('session.counts', { due: session.dueCount, fresh: session.newCount, total: session.total })
  else summaryEl.textContent = t('session.upToDate')
  if (!session.total) { setActions({}); return { destroy() {} } }

  bodyEl.innerHTML = `
    <button type="button" class="btn-start primary">${t('session.start', { count: session.total })}</button>
    <div class="drill-host" hidden></div>
    <div class="actions session-actions" hidden>
      <button type="button" class="btn-hint">${t('session.hint')}</button>
      <button type="button" class="btn-restart">${t('session.replay')}</button>
      <button type="button" class="btn-continue primary" disabled>${t('continue')}</button>
    </div>
  `
  const startBtn = bodyEl.querySelector('.btn-start')
  const drillHost = bodyEl.querySelector('.drill-host')
  const actionsEl = bodyEl.querySelector('.actions')
  const continueBtn = bodyEl.querySelector('.btn-continue')

  let index = 0
  let drill = null
  let hud = null
  let sessionXp = 0
  let flawlessCount = 0

  function playCurrent() {
    const item = session.queue[index]
    const opening = resolveOpening(item.openingId, { selection, openings })
    const sideEn = opening.side
    const lines = linesByOpening[item.openingId] || []
    const p = state.progress[item.openingId] || {}
    // learn (cycle Découvrir/Rappeler/Réviser, spec 15.1, chantier X2) : mêmes briques pures que
    // l'écran d'entraînement d'une ouverture (src/core/learn.js), recalculées ici par ouverture.
    const learn = {
      phases: phasesFor(statusOf(p, item.line.id)),
      knownPrefix: knownPrefixLength(item.line, lines, p),
      weak: p[item.line.id]?.weak || [],
      explain: explainByOpening[item.openingId],
    }
    drill?.destroy()
    continueBtn.disabled = true
    drill = mountLineDrill(drillHost, {
      sideEn,
      t,
      locale: state.settings.locale,
      guided: eloToBand(state.settings.elo, state.settings.eloSource) === 'debutant',
      getSounds: () => state.settings.sounds,
      onMoveResult: (ok) => (ok ? hud?.correct() : hud?.miss()),
      onFinish: (errors, { weak, aided, checkmate, own, ms } = {}) => {
        // weak (chantier X2) patché dans le RÉSULTAT de recordRun, jamais dans son entrée : voir le
        // commentaire de persist() dans src/ui/trainer.js pour le bug que ça évite (entrée partielle
        // prise pour une entrée existante, runs -> NaN sur une ligne encore jamais jouée).
        const prevProgress = state.progress[item.openingId] || {}
        const wasMastered = statusOf(prevProgress, item.line.id) === 'mastered'
        const next = recordRun(prevProgress, item.line.id, errors, Date.now(), { aided })
        const patched = weak !== undefined ? { ...next, [item.line.id]: { ...next[item.line.id], weak } } : next
        saveProgress(item.openingId, patched).then(() => {
          const verdict = verdictText(lineEnding({ evals: item.line.evals, moves: item.line.moves, side: sideEn, checkmate }), t)
          const res = game?.recordLine({
            openingId: item.openingId, lineId: item.line.id, phase: item.isNew ? 'new' : 'due', errors, aided, own, ms, checkmate,
            becameMastered: !wasMastered && statusOf(patched, item.line.id) === 'mastered',
            comboMax: hud?.comboMax ?? 0, moveXp: hud?.lineXp ?? 0,
          })
          if (res) { hud?.lineEnd(res); sessionXp += res.xp }
          if (!errors) flawlessCount++
          const gain = res ? t('session.xp', { xp: res.xp }) : ''
          drill.setFeedback(errors ? 'warn' : 'good', errors
            ? t('session.finishedErrors', { errors, opening: state.settings.locale === 'fr' ? opening.name : opening.lichessName || opening.name, gain })
            : t('session.finishedPerfect', { opening: state.settings.locale === 'fr' ? opening.name : opening.lichessName || opening.name, verdict, gain }))
          continueBtn.disabled = false
          continueBtn.textContent = index + 1 < session.queue.length ? t('continue') : t('session.finish')
        })
      },
    })
    hud = game ? mountHud(drillHost, game, { getOpeningId: () => item.openingId, getLineId: () => item.line.id, getSounds: () => state.settings.sounds, getLocale: () => state.settings.locale }) : null
    hud?.startLine()
    openingEl.textContent = state.settings.locale === 'fr' ? opening.name : opening.lichessName || opening.name
    summaryEl.textContent = t('session.lineOf', { index: index + 1, total: session.queue.length })
    const difficulty = difficultyByOpening[item.openingId]
    difficultyEl.hidden = !difficulty
    difficultyEl.textContent = difficulty ? t('session.openingDifficulty', { difficulty }) : ''
    drill.setLine(item.line, { message: t(item.isNew ? 'session.newLine' : 'session.reviewLine'), learn })
  }
  function advance() {
    if (continueBtn.disabled) return
    index++
    if (index >= session.queue.length) {
      drill?.destroy()
      drillHost.hidden = true
      actionsEl.hidden = true
      bodyEl.querySelector('.btn-start').hidden = true
      const n = session.queue.length
      openingEl.textContent = t('session.completeTitle')
      summaryEl.textContent = t('session.completeSummary', { lines: n, flawless: flawlessCount, xp: sessionXp })
      difficultyEl.hidden = true
      bodyEl.insertAdjacentHTML('beforeend', `
        <div class="session-end">
          <a class="cta primary" href="#/">${t('session.challenges')}</a>
          <a class="cta" href="#/rush">${t('session.rush')}</a>
        </div>`)
      setActions({})
      return
    }
    playCurrent()
  }
  function start() {
    sound.unlock()
    startBtn.hidden = true
    drillHost.hidden = false
    actionsEl.hidden = false
    playCurrent()
    setActions({
      next: advance,
      hint: () => drill?.hint(),
      restart: () => drill?.restart(),
    })
  }
  startBtn.addEventListener('click', start)
  continueBtn.addEventListener('click', advance)
  bodyEl.querySelector('.btn-hint').addEventListener('click', () => drill?.hint())
  bodyEl.querySelector('.btn-restart').addEventListener('click', () => drill?.restart())

  setActions({})
  // #/session/go (bouton Commencer d'Aujourd'hui) : la séance démarre sans 2e geste.
  if (params.go) start()

  return {
    destroy() {
      drill?.destroy()
    },
  }
}
