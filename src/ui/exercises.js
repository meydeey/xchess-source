import { Chessground } from 'chessground'
import { Chess } from 'chess.js'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import '../visual-exercises.css'
import { PUZZLE_MODES, playUci, puzzleStart } from '../core/puzzles.js'
import { chooseTrainingPuzzle, derivePuzzleTraining, needsPuzzleGuidance, trainingTarget } from '../core/puzzle-training.js'
import { CHALLENGE_STAGES } from '../core/challenges.js'
import * as sound from './sound.js'
import { showPromotion } from './promotion.js'

const THEMES = ['fork', 'pin', 'hangingPiece', 'defensiveMove', 'mateIn1', 'mateIn2', 'promotion', 'endgame', 'skewer', 'discoveredAttack']
const EXTRA_MODES = ['mate1-series', 'mate1-timed']
const SKILL_MODES = ['mixed', 'attack', 'tactics', 'defense', 'technique']
const ART = {
  mixed: 'skill-mixed',
  attack: 'skill-attack',
  tactics: 'skill-tactics',
  defense: 'skill-defense',
  technique: 'skill-technique',
  themes: 'skill-motifs',
  mate1: 'advanced-series',
  'mate1-series': 'advanced-series',
  'mate1-timed': 'advanced-timed',
  rush: 'advanced-rush',
  arena: 'advanced-arena',
}
const CHEVRON = '<svg class="exercise-tile-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'

function mountHub(host, { t, setActions }) {
  function card(key, { href = `#/exercises/${key}`, title = t(`mode.${key}`), summary = t(`mode.${key}.summary`) } = {}) {
    return `<a class="exercise-illustrated-tile" href="${href}">
      <img class="exercise-cover" src="/art/${ART[key]}.webp" data-art="${ART[key]}" alt="" decoding="async">
      <span class="exercise-tile-copy"><span><strong>${title}</strong><small>${summary}</small></span>${CHEVRON}</span>
    </a>`
  }
  host.innerHTML = `
    <div class="exercise-landing exercise-visual-landing">
      <h1 class="exercise-landing-title">${t('exercises.title')}</h1>
      <section class="exercise-warmup" aria-labelledby="exercise-warmup">
        <div class="exercise-warmup-copy">
          <span class="exercise-warmup-label">${t('exercises.warmup')}</span>
          <h2 id="exercise-warmup">${t('mode.mate1')}</h2>
          <p>${t('mode.mate1.summary')}</p>
          <a class="cta primary" href="#/exercises/mate1">${t('exercises.playOne')}</a>
        </div>
        <span class="exercise-warmup-photo"><img class="exercise-warmup-art" src="/art/${ART.mate1}.webp" alt="" decoding="async"></span>
      </section>
      <section aria-labelledby="exercise-skills">
        <h2 id="exercise-skills">${t('exercises.skills')}</h2>
        <div class="exercise-illustrated-grid">
          ${SKILL_MODES.map((key) => card(key)).join('')}
          ${card('themes', { title: t('exercises.patterns'), summary: t('exercises.patternsSummary') })}
        </div>
      </section>
      <section aria-labelledby="exercise-challenges">
        <h2 id="exercise-challenges">${t('exercises.advanced')}</h2>
        <div class="exercise-illustrated-grid exercise-advanced-grid">
          ${EXTRA_MODES.map((key) => card(key)).join('')}
          ${card('rush', { href: '#/rush', title: 'XChess Rush', summary: t('exercises.rushSummary') })}
          ${card('arena', { href: '#/arena', title: t('arena.title'), summary: t('arena.summary') })}
        </div>
      </section>
      <p class="exercise-credit">${t('exercises.source')}</p>
    </div>
  `
  setActions({})
  return { destroy() {} }
}

function mountThemes(host, { t, setActions }) {
  host.innerHTML = `
    <div class="exercise-motifs">
      <header class="exercise-head exercise-toolbar">
        <div class="exercise-identity">
          <a class="exercise-back" href="#/exercises" aria-label="${t('exercises.back')}"><span aria-hidden="true">←</span></a>
          <h1 class="exercise-title">${t('exercises.patterns')}</h1>
        </div>
      </header>
      <p class="exercise-motifs-intro">${t('exercises.patternsSummary')}</p>
      <div class="exercise-motifs-grid">
        ${THEMES.map((key) => `<a href="#/exercises/theme/${key}"><span>${t(`theme.${key}`)}</span>${CHEVRON}</a>`).join('')}
      </div>
    </div>
  `
  setActions({})
  return { destroy() {} }
}

function primaryTheme(puzzle) {
  return [...THEMES, 'mateIn1', 'mateIn2', 'promotion', 'endgame', 'skewer', 'discoveredAttack'].find((theme) => puzzle.themes.includes(theme)) || null
}

function solutionLine(puzzle) {
  const chess = new Chess(puzzle.fen)
  if (!playUci(chess, puzzle.moves[0])) return ''
  return puzzle.moves.slice(1).map((uci) => playUci(chess, uci)?.san).filter(Boolean).join(' ')
}

const packPromises = new Map()
async function loadPack(includeAdvanced = false) {
  const key = includeAdvanced ? 'advanced' : 'base'
  if (!packPromises.has(key)) packPromises.set(key, (async () => {
    const indexResponse = await fetch(new URL('packs/index.json', document.baseURI))
    if (!indexResponse.ok) throw new Error('exercises.indexUnavailable')
    const index = await indexResponse.json()
    const manifests = index.packs?.filter((pack) => includeAdvanced || !pack.minRating)
    if (!Array.isArray(manifests) || !manifests.length) throw new Error('exercises.indexInvalid')
    const packs = []
    for (const manifest of manifests) {
      if (!/^puzzles(?:-advanced|-motifs)?-[\d-]+\.json$/.test(manifest?.file)) throw new Error('exercises.indexInvalid')
      const response = await fetch(new URL(`packs/${manifest.file}`, document.baseURI))
      if (!response.ok) throw new Error('exercises.packUnavailable')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength !== manifest.bytes) throw new Error('exercises.packIncomplete')
      if (crypto.subtle) {
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
        if (hash !== manifest.sha256) throw new Error('exercises.packAltered')
      }
      const pack = JSON.parse(new TextDecoder().decode(bytes))
      if (!Array.isArray(pack.puzzles) || pack.puzzles.length !== manifest.count) throw new Error('exercises.packInvalid')
      packs.push(pack)
    }
    return { version: index.version, puzzles: packs.flatMap((pack) => pack.puzzles), total: manifests.reduce((sum, pack) => sum + pack.count, 0) }
  })())
  try { return await packPromises.get(key) } catch (error) { packPromises.delete(key); throw error }
}

function destsOf(chess) {
  const dests = new Map()
  for (const move of chess.moves({ verbose: true })) {
    if (!dests.has(move.from)) dests.set(move.from, [])
    dests.get(move.from).push(move.to)
  }
  return dests
}

export async function mount(host, ctx) {
  const mode = ctx.params?.mode
  const theme = ctx.params?.theme
  const challengeStage = mode === 'mixed' ? CHALLENGE_STAGES.find((stage) => stage.id === theme) : null
  const { t } = ctx
  if (!mode) return mountHub(host, ctx)
  if (mode === 'themes' && !theme) return mountThemes(host, ctx)
  if (!PUZZLE_MODES.includes(mode) && !EXTRA_MODES.includes(mode) && !(mode === 'theme' && THEMES.includes(theme))) {
    host.innerHTML = `<p class="empty">${t('exercises.unknown')} <a href="#/exercises">${t('exercises.back')}</a></p>`
    ctx.setActions({})
    return { destroy() {} }
  }
  host.innerHTML = `<p class="empty">${t('exercises.loading')}</p>`
  const attempts = await ctx.getPuzzleAttempts()
  const training = derivePuzzleTraining(attempts)
  const includeAdvanced = mode === 'theme' || !!challengeStage || (!mode.startsWith('mate1') && Object.values(training).some((category) => trainingTarget(category, ctx.state.settings.elo, ctx.state.settings.eloSource) > 1650))
  let puzzlesPack
  try { puzzlesPack = await loadPack(includeAdvanced) } catch (error) {
    host.innerHTML = `
      <h1>${t('exercises.title')}</h1>
      <p class="empty" role="status"></p>
      <div class="actions">
        <button type="button" class="cta primary">${t('exercises.retry')}</button>
        <a class="cta" href="#/exercises">${t('exercises.back')}</a>
      </div>
    `
    host.querySelector('[role=status]').textContent = t(error.message.startsWith('exercises.') ? error.message : 'exercises.loadError')
    host.querySelector('button').addEventListener('click', () => ctx.navigate(location.hash))
    ctx.setActions({})
    return { destroy() {} }
  }
  const { state, game, savePuzzleAttempt, setActions } = ctx
  const selectionMode = mode.startsWith('mate1') || theme === 'mateIn1' ? 'mate1' : mode === 'theme' ? 'mixed' : mode
  const modeArt = ART[mode === 'theme' ? (selectionMode === 'mate1' ? 'mate1' : 'themes') : mode]
  const backLink = mode === 'theme' ? '#/exercises/themes' : '#/exercises'
  const backLabel = t(mode === 'theme' ? 'exercises.patterns' : 'exercises.back')
  const challengePool = challengeStage ? puzzlesPack.puzzles.filter((puzzle) => puzzle.rating >= challengeStage.min && puzzle.rating <= challengeStage.max) : puzzlesPack.puzzles
  let guided = false
  host.classList.add('board-screen', 'exercise-screen')
  host.innerHTML = `
    <div class="exercise-page exercise-visual-run">
      <header class="exercise-head exercise-toolbar">
        <div class="exercise-identity"><a class="exercise-back" href="${backLink}" aria-label="${backLabel}" title="${backLabel}"><span aria-hidden="true">←</span></a><h1 class="exercise-title">${mode === 'theme' ? t(`theme.${theme}`) : challengeStage ? `${t(`mode.${mode}`)} · ${t(`path.stage.${challengeStage.id}`)}` : t(`mode.${mode}`)}</h1></div>
        <div class="exercise-run-meta"><span class="exercise-record" ${EXTRA_MODES.includes(mode) ? '' : 'hidden'}>${t('exercises.bestRecord', { count: state.settings[mode === 'mate1-series' ? 'mate1SeriesBest' : 'mate1TimedBest'] || 0 })}</span><span class="exercise-timer mono" ${mode === 'mate1-timed' ? '' : 'hidden'}>3:00</span><p class="exercise-score mono" aria-live="polite">${t('exercises.score', { solved: 0, played: 0 })}</p></div>
      </header>
      <div class="drill-host exercise-stage">
        <section class="board-col">
          <div class="board-frame"><div class="cg-wrap board"></div><div class="promotion-choices" role="dialog" aria-modal="true" hidden aria-label="${t('exercises.promotion')}"></div></div>
        </section>
        <section class="drill-info exercise-info">
          <img class="exercise-session-art" src="/art/${modeArt}.webp" data-art="${modeArt}" alt="" decoding="async">
          <p class="exercise-rating exercise-detail"></p>
          <h2 class="exercise-prompt"></h2>
          <p class="feedback" data-tone="neutral" role="status">${t('exercises.yourTurn')}</p>
          <div class="exercise-explanation" hidden></div>
          <div class="actions exercise-actions">
            <button type="button" class="btn-hint">${t('exercises.hint')}</button>
            <button type="button" class="btn-next primary" hidden>${t('exercises.next')}</button>
          </div>
          <label class="exercise-auto-next"><input type="checkbox" ${state.settings.autoNextPuzzle ? 'checked' : ''}> ${t('exercises.autoNext')}</label>
          <p class="exercise-source">${t('exercises.source')}</p>
        </section>
      </div>
    </div>
  `
  const boardEl = host.querySelector('.board')
  const frame = host.querySelector('.board-frame')
  const ratingEl = host.querySelector('.exercise-rating')
  const promptEl = host.querySelector('.exercise-prompt')
  const feedbackEl = host.querySelector('.feedback')
  const scoreEl = host.querySelector('.exercise-score')
  const recordEl = host.querySelector('.exercise-record')
  const timerEl = host.querySelector('.exercise-timer')
  const hintEl = host.querySelector('.btn-hint')
  const explanationEl = host.querySelector('.exercise-explanation')
  const nextEl = host.querySelector('.btn-next')
  const autoNextEl = host.querySelector('.exercise-auto-next input')
  const promotionEl = host.querySelector('.promotion-choices')
  const st = { puzzle: null, chess: null, orientation: 'white', index: 1, recent: [], turn: 0, played: 0, solved: 0, seriesMistakes: 0, runStartedAt: 0, runEnded: false, errors: 0, hints: 0, startedAt: 0, complete: false, busy: false, timer: null, clock: null, pendingPromotion: null }
  const cg = Chessground(boardEl, {
    coordinates: true,
    animation: { enabled: true, duration: 100 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    drawable: { enabled: true, visible: true },
    movable: { free: false, showDests: true, events: { after: onBoardMove } },
  })
  const ro = new ResizeObserver((entries) => {
    if (entries[0]?.contentRect.width > 0) cg.redrawAll()
  })
  ro.observe(frame)

  function feedback(tone, text) {
    feedbackEl.dataset.tone = tone
    feedbackEl.textContent = text
  }
  function currentMotif() {
    if (selectionMode === 'mate1') return 'mateIn1'
    return mode === 'theme' ? theme : primaryTheme(st.puzzle)
  }
  function boardState(lastMove) {
    cg.set({
      fen: st.chess.fen(), turnColor: st.chess.turn() === 'w' ? 'white' : 'black',
      check: st.chess.inCheck(), lastMove,
      movable: { color: st.complete || st.busy ? undefined : st.chess.turn() === 'w' ? 'white' : 'black', dests: st.complete || st.busy ? new Map() : destsOf(st.chess) },
    })
  }
  function endRun(key) {
    if (st.runEnded) return
    st.runEnded = true
    st.complete = true
    clearTimeout(st.timer)
    clearInterval(st.clock)
    boardState()
    hintEl.hidden = true
    nextEl.hidden = false
    nextEl.textContent = t('exercises.restartRun')
    feedback('good', t(key, { solved: st.solved }))
    if (mode === 'mate1-series' && st.solved > (state.settings.mate1SeriesBest || 0)) {
      ctx.saveSettings({ mate1SeriesBest: st.solved })
      recordEl.textContent = t('exercises.bestRecord', { count: st.solved })
    }
    if (mode === 'mate1-timed' && st.solved > (state.settings.mate1TimedBest || 0)) {
      ctx.saveSettings({ mate1TimedBest: st.solved })
      recordEl.textContent = t('exercises.bestRecord', { count: st.solved })
    }
  }
  function tick() {
    const remaining = Math.max(0, 180 - Math.floor((Date.now() - st.runStartedAt) / 1000))
    timerEl.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
    if (remaining === 0) endRun('exercises.timeEnd')
  }
  function next() {
    clearTimeout(st.timer)
    if (st.runEnded) {
      st.runEnded = false
      st.played = 0
      st.solved = 0
      st.seriesMistakes = 0
      st.runStartedAt = 0
      scoreEl.textContent = t('exercises.score', { solved: 0, played: 0 })
    }
    if (mode === 'mate1-timed' && !st.runStartedAt) {
      st.runStartedAt = Date.now()
      st.clock = setInterval(tick, 1000)
      tick()
    }
    nextEl.textContent = t('exercises.next')
    st.puzzle = chooseTrainingPuzzle(challengePool, {
      mode: selectionMode, theme: mode === 'theme' ? theme : null, attempts, recent: st.recent, turn: st.turn,
      elo: state.settings.elo, source: state.settings.eloSource,
    })
    if (!st.puzzle) {
      feedback('bad', t('exercises.none'))
      return
    }
    st.recent.push(st.puzzle.id)
    st.turn++
    st.chess = new Chess(st.puzzle.fen)
    const last = playUci(st.chess, st.puzzle.moves[0])
    st.index = 1
    st.errors = 0
    st.hints = 0
    st.startedAt = Date.now()
    st.complete = false
    st.busy = false
    st.pendingPromotion = null
    promotionEl.hidden = true
    explanationEl.hidden = true
    hintEl.hidden = false
    nextEl.hidden = true
    st.orientation = puzzleStart(st.puzzle).side
    cg.set({ orientation: st.orientation })
    boardState([last.from, last.to])
    cg.setAutoShapes([])
    const categoryTraining = training[st.puzzle.cat]
    guided = needsPuzzleGuidance(categoryTraining, state.settings.elo, state.settings.eloSource)
    ratingEl.textContent = `${t('exercises.difficulty', { rating: st.puzzle.rating })} · ${categoryTraining.count < 10 ? t('exercises.calibrating') : t('exercises.trainingRating', { rating: Math.round(categoryTraining.rating) })}`
    promptEl.textContent = t(selectionMode === 'mate1' ? 'exercises.mateQuestion' : guided ? 'exercises.guidedQuestion' : 'exercises.moveQuestion')
    feedback('neutral', t('exercises.yourTurn'))
  }
  async function finish(solved, message) {
    if (st.complete) return
    const finishedPuzzle = st.puzzle
    st.complete = true
    st.busy = false
    st.played++
    if (solved) st.solved++
    boardState()
    hintEl.hidden = true
    nextEl.hidden = false
    promotionEl.hidden = true
    scoreEl.textContent = t('exercises.score', { solved: st.solved, played: st.played })
    feedback(solved ? 'good' : 'bad', message)
    const motif = currentMotif()
    const solution = solved && selectionMode === 'mate1' ? st.chess.history().at(-1) : solutionLine(st.puzzle)
    explanationEl.textContent = t('exercises.explanation', { motif: motif ? t(`theme.${motif}`) : t(`mode.${st.puzzle.cat}`), solution })
    explanationEl.hidden = false
    const result = solved ? 'solved' : 'failed'
    const attempt = {
      id: finishedPuzzle.id, mode, result, errors: st.errors, ms: Date.now() - st.startedAt,
      rating: finishedPuzzle.rating, cat: finishedPuzzle.cat, aided: st.hints > 0, theme: motif,
      packVersion: finishedPuzzle.id.split('@')[1] || puzzlesPack.version,
    }
    if (solved) sound.play(st.chess.isCheckmate() ? 'mate' : 'success', { sounds: state.settings.sounds })
    else sound.play('error', { sounds: state.settings.sounds })
    if (mode === 'mate1-series') {
      st.seriesMistakes += attempt.errors
      if (st.seriesMistakes >= 3) endRun('exercises.seriesEnd')
    }
    let saved = false
    try {
      const res = game?.recordPuzzle?.(attempt, (activity, allActivity) => savePuzzleAttempt(attempt, activity, allActivity))
      saved = await (res?.saved ?? savePuzzleAttempt(attempt))
      if (saved) {
        attempts.push({ ...attempt, ref: attempt.id, at: Date.now() })
        Object.assign(training, derivePuzzleTraining(attempts))
      }
    } catch {
      saved = false
    }
    if (!saved && st.puzzle === finishedPuzzle) feedback('bad', t('exercises.saveError'))
    if (solved && saved && st.puzzle === finishedPuzzle && !st.runEnded && autoNextEl.checked) {
      st.timer = setTimeout(() => {
        if (st.complete && st.puzzle === finishedPuzzle && !st.runEnded && autoNextEl.checked) next()
      }, 350)
    }
  }
  function mistake() {
    st.errors++
    st.chess.undo()
    boardState()
    if (st.errors < 3) sound.play('error', { sounds: state.settings.sounds })
    if (st.errors >= 3) {
      const expected = st.puzzle.moves[st.index]
      cg.setAutoShapes([{ orig: expected.slice(0, 2), dest: expected.slice(2, 4), brush: 'green' }])
      finish(false, t('exercises.reveal'))
    } else {
      const motif = currentMotif()
      feedback('bad', guided && st.errors === 1 && motif ? t('exercises.guidedRetry', { hint: t(`themeHint.${motif}`) }) : t(st.errors === 1 ? 'exercises.tryAgain' : 'exercises.oneMore'))
    }
  }
  function handleMove(orig, dest, promotion) {
    if (st.complete || st.busy) return
    const move = playUci(st.chess, orig + dest + (promotion || ''))
    if (!move) { boardState(); return }
    const uci = move.from + move.to + (move.promotion || '')
    const expected = st.puzzle.moves[st.index]
    if (selectionMode === 'mate1') {
      if (st.chess.isCheckmate()) finish(true, t(st.errors === 0 ? 'exercises.mate' : 'exercises.mateHelp', { move: move.san }))
      else mistake()
      return
    }
    if (uci !== expected) { mistake(); return }
    st.index++
    if (st.index >= st.puzzle.moves.length || st.chess.isGameOver()) {
      finish(true, t(st.errors === 0 ? 'exercises.good' : 'exercises.goodHelp', { move: move.san }))
      return
    }
    st.busy = true
    boardState([move.from, move.to])
    sound.play(move.captured ? 'capture' : 'move', { sounds: state.settings.sounds })
    feedback('good', t('exercises.reply', { move: move.san }))
    st.timer = setTimeout(() => {
      const reply = playUci(st.chess, st.puzzle.moves[st.index])
      if (!reply) { finish(false, t('exercises.invalid')); return }
      st.index++
      st.busy = false
      boardState([reply.from, reply.to])
      feedback('neutral', t('exercises.followup'))
    }, 180)
  }
  function onBoardMove(orig, dest) {
    if (st.complete || st.busy) return
    sound.unlock()
    const piece = st.chess.get(orig)
    if (piece?.type === 'p' && (dest[1] === '1' || dest[1] === '8')) {
      st.pendingPromotion = { orig, dest }
      showPromotion(promotionEl, { dest, color: piece.color, orientation: st.orientation, t })
      return
    }
    handleMove(orig, dest)
  }
  promotionEl.addEventListener('click', (event) => {
    const code = event.target.closest('button')?.dataset.piece
    if (!st.pendingPromotion) return
    if (!code) { st.pendingPromotion = null; promotionEl.hidden = true; boardState(); return }
    const { orig, dest } = st.pendingPromotion
    st.pendingPromotion = null
    promotionEl.hidden = true
    handleMove(orig, dest, code)
  })
  promotionEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !st.pendingPromotion) return
    st.pendingPromotion = null
    promotionEl.hidden = true
    boardState()
  })
  hintEl.addEventListener('click', () => {
    if (st.complete || st.busy) return
    st.hints++
    const motif = currentMotif()
    feedback('neutral', motif ? t('exercises.hintText', { hint: t(`themeHint.${motif}`) }) : t('exercises.generalHint'))
  })
  nextEl.addEventListener('click', next)
  autoNextEl.addEventListener('change', () => ctx.saveSettings({ autoNextPuzzle: autoNextEl.checked }))
  setActions({ next })
  next()
  return { destroy() { clearTimeout(st.timer); clearInterval(st.clock); ro.disconnect(); cg.destroy() } }
}

// Finite campaign preparations share the verified packs and factual solution rendering.
export { loadPack, solutionLine, primaryTheme }
