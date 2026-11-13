import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import season from '../../catalog/adventure-season-1.json'
import { restoreDuel, evaluateDuel, selectPreparation, validateCheckpoint } from '../core/adventure.js'
import { playUci, puzzleStart } from '../core/puzzles.js'
import { derivePuzzleTraining, trainingTarget } from '../core/puzzle-training.js'
import { platform } from '../platform/index.js'
import { loadPack, solutionLine, primaryTheme } from './exercises.js'
import { mountCompanion } from './companion.js'
import { showPromotion } from './promotion.js'
import { escapeHtml } from './shared.js'
import { textOf, portrait } from './adventure-shared.js'
import * as sound from './sound.js'

export async function mountEncounter(host, ctx, encounter) {
  const { t, state } = ctx
  const locale = state.settings.locale
  const collection = await ctx.getCollection()
  const record = ctx.getAdventure().encounters[encounter.id]
  const latest = Object.entries(record.attempts).sort((a, b) => b[1].at - a[1].at || b[0].localeCompare(a[0]))[0]
  let attemptId = latest?.[0] || crypto.randomUUID()
  let step = latest?.[1].step ?? -1
  let checkpoint = structuredClone(latest?.[1].checkpoint || { phase: 'invitation', aided: false })
  let busy = false, pending = null, error = null, message = '', retryWork = null
  let cg = null, companion = null, renderKey = null, destroyed = false, promotion = null, keyboard = false
  const abort = new AbortController()
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  const motionChanged = () => cg?.set({ animation: { enabled: !reducedMotion.matches, duration: 120 } })
  reducedMotion.addEventListener('change', motionChanged)
  const side = encounter.side === 'white' ? 'w' : 'b'
  const snapshot = () => structuredClone(checkpoint)
  const opening = () => !!encounter.opening && checkpoint.preparationIndex === 0
  const puzzle = () => checkpoint.puzzles?.[checkpoint.preparationIndex - (encounter.opening ? 1 : 0)]
  const data = () => checkpoint.phase === 'duel' ? checkpoint.duel : checkpoint.preparationState
  const chessOf = () => restoreDuel(data())
  const scope = () => `${encounter.id}:${attemptId}:${checkpoint.phase}:${checkpoint.preparationIndex ?? ''}`
  const motif = () => t(encounter.theme === 'advantage' ? 'adventure.motif.advantage' : `theme.${encounter.theme}`)
  host.classList.add('adventure-screen', 'board-screen')

  function release() { cg?.destroy(); cg = null; companion?.destroy(); companion = null }
  function controls() {
    for (const button of host.querySelectorAll('button, input')) button.disabled = busy || !!pending
    const retry = host.querySelector('.adventure-retry-save')
    if (retry) { retry.hidden = error !== 'save'; retry.disabled = busy }
    const retryEngine = host.querySelector('.adventure-retry-engine')
    if (retryEngine) { retryEngine.hidden = error !== 'engine'; retryEngine.disabled = busy || !!pending }
    const status = host.querySelector('.adventure-status')
    if (status) status.textContent = busy && pending ? t('adventure.saving') : error ? t(error === 'save' ? 'adventure.saveError' : error === 'engine' ? 'adventure.enginePaused' : error === 'load' ? 'exercises.loadError' : error === 'journal' ? 'adventure.journalUnavailable' : error === 'selection' ? 'adventure.preparationUnavailable' : 'adventure.invalidHistory') : ''
  }
  async function flush() {
    if (!pending || busy || destroyed) return false
    busy = true; controls()
    const work = pending
    const ok = await ctx.saveAdventureFact(work.fact)
    if (destroyed) return ok
    busy = false
    if (!ok) {
      // An earlier screen may have finished this write while this screen was mounting.
      const saved = ctx.getAdventure().encounters[encounter.id].attempts[work.fact.attemptId]
      if (saved && saved.step >= work.fact.step) {
        checkpoint = structuredClone(saved.checkpoint); step = saved.step; pending = null; error = null
        render(); await advance(); return true
      }
      error = 'save'; update(); return false
    }
    checkpoint = work.fact.checkpoint; step = work.fact.step; pending = null; error = null
    render()
    await work.after?.()
    return true
  }
  function commit(next, puzzleAttempt = null, after = null) {
    if (pending || busy || destroyed) return Promise.resolve(false)
    pending = { fact: { seasonId: season.id, seasonVersion: season.version, encounterId: encounter.id, encounterVersion: encounter.version, attemptId, step: step + 1, checkpoint: next, ...(puzzleAttempt ? { puzzleAttempt } : {}) }, after }
    return flush()
  }
  function preparationAt(next, index) {
    const isOpening = !!encounter.opening && index === 0
    const item = next.puzzles[index - (encounter.opening ? 1 : 0)]
    return { initialFen: isOpening ? new Chess().fen() : puzzleStart(item).fen, moves: [], index: isOpening ? 0 : 1, errors: 0, hints: 0, done: false, startedAt: Date.now() }
  }
  async function start(retry = false) {
    if (busy || pending) return
    if (!ctx.canSaveAdventure) { error = 'journal'; controls(); return }
    busy = true; error = null; controls()
    try {
      let next
      if (retry && checkpoint.puzzles) {
        next = { ...snapshot(), phase: 'duel', result: null, confirmed: false, aided: !!checkpoint.preparationAided, duel: { initialFen: encounter.duel.initialFen, moves: [], evaluations: [], stage: 'player' } }
      } else {
        const pack = await loadPack(true)
        const training = derivePuzzleTraining(await ctx.getPuzzleAttempts())
        const target = trainingTarget(training[encounter.category], state.settings.elo, state.settings.eloSource)
        const puzzles = selectPreparation(pack.puzzles, { theme: encounter.theme, target, count: encounter.opening ? 2 : 3 })
        next = { phase: 'preparation', aided: false, preparationAided: false, puzzles, puzzleIds: puzzles.map((item) => item.id), packVersion: pack.version, preparationIndex: 0 }
        next.preparationState = preparationAt(next, 0)
      }
      if (destroyed) return
      attemptId = crypto.randomUUID(); step = -1; busy = false; message = ''
      await commit(next, null, advance)
    } catch (failure) { if (!destroyed) { busy = false; error = failure.message === 'adventure.preparationUnavailable' ? 'selection' : 'load'; controls(); host.querySelector('.adventure-status').textContent = t(failure.message === 'adventure.preparationUnavailable' ? failure.message : 'exercises.loadError') } }
  }
  async function nextPreparation() {
    if (busy || pending || !checkpoint.preparationState?.done) return
    const next = snapshot()
    if (checkpoint.preparationIndex === 2) {
      next.phase = 'duel'
      next.duel = { initialFen: encounter.duel.initialFen, moves: [], evaluations: [], stage: 'player' }
    } else { next.preparationIndex++; next.preparationState = preparationAt(next, next.preparationIndex) }
    message = ''
    await commit(next, null, advance)
  }
  const errorsPanel = () => `<p class="adventure-status" role="status" aria-live="polite"></p><button class="adventure-retry-save" hidden>${t('adventure.retrySave')}</button><button class="adventure-retry-engine" hidden>${t('adventure.retryEngine')}</button>`
  function render() {
    if (destroyed) return
    let key = `${checkpoint.phase}:${checkpoint.preparationIndex ?? ''}:${attemptId}`
    try { validateCheckpoint(checkpoint, encounter) } catch { key = 'invalid' }
    if (!['invitation', 'preparation', 'duel', 'result'].includes(checkpoint.phase) || checkpoint.phase === 'result' && !checkpoint.confirmed) key = 'invalid'
    if (checkpoint.phase === 'preparation' || checkpoint.phase === 'duel') {
      try { chessOf() } catch { key = 'invalid' }
    }
    if (key === renderKey) { update(); return }
    release(); renderKey = key
    const heading = `<p class="eyebrow"><a href="#/adventure">${t('adventure.back')}</a></p><header class="adventure-encounter-heading">${portrait(encounter.opponent.portrait, encounter.opponent.name)}<div><p>${escapeHtml(encounter.opponent.name)}</p><h1>${escapeHtml(textOf(encounter.title, locale))}</h1></div></header>`
    if (key === 'invalid') {
      host.innerHTML = `${heading}<p>${t('adventure.invalidHistory')}</p><button class="adventure-replay">${t('adventure.replay')}</button>${errorsPanel()}`
    } else if (checkpoint.phase === 'invitation') {
      host.innerHTML = `${heading}<div class="adventure-invitation"><p>${escapeHtml(textOf(encounter.opponent.invitation, locale))}</p><p class="adventure-objective">${t(`adventure.goal.${encounter.goal}`)}</p>${encounter.goal === 'material' ? `<p class="adventure-material-values">${t('adventure.materialValues')}</p>` : ''}<p>${t('adventure.side', { side: t(`side.${encounter.side}`) })}</p><div class="adventure-rabbit"></div><button class="primary adventure-start">${t('adventure.start')}</button>${errorsPanel()}</div>`
    } else if (checkpoint.phase === 'result') {
      const won = checkpoint.result === 'won'
      const chapter = season.chapters.find((item) => item.id === encounter.chapterId)
      const completed = ctx.getAdventure().completedChapters.includes(chapter.id) && won && chapter.encounters[2] === encounter.id
      const reason = !won && ['mate', 'advantage', 'defense'].includes(checkpoint.reason) ? 'lost' : 'result'
      host.innerHTML = `${heading}<section class="adventure-result" data-won="${won}"><h2>${t(won ? 'adventure.won' : 'adventure.lost')}</h2><p>${escapeHtml(t(`adventure.${reason}.${checkpoint.reason || 'limit'}`, { gain: checkpoint.gain || 0 }))}</p><p>${won ? t(checkpoint.aided ? 'adventure.assisted' : 'adventure.unaided') : ''}</p><blockquote>${escapeHtml(textOf(encounter.opponent[won ? 'won' : 'lost'], locale))}</blockquote><div class="adventure-rabbit"></div>${completed ? `<section class="adventure-passage"><h3>${t('adventure.passage')}</h3><p>${escapeHtml(textOf(chapter.passage, locale))}</p><p>${t('adventure.reward', { rabbit: t(`skin.${chapter.reward.rabbit}`), board: t(`board.${chapter.reward.board}`) })}</p><a href="#/collection">${t('collection.open')}</a></section>` : ''}<div class="actions"><a href="#/adventure" class="button primary">${t('adventure.next')}</a>${won ? `<button class="adventure-replay">${t('adventure.replay')}</button>` : `<button class="adventure-retry-duel primary">${t('adventure.retryDuel')}</button>`}</div>${errorsPanel()}</section>`
    } else {
      const isDuel = checkpoint.phase === 'duel'
      host.innerHTML = `${heading}<p class="adventure-step">${t(isDuel ? 'adventure.duel' : 'adventure.preparation', { number: checkpoint.preparationIndex + 1 })} · ${escapeHtml(motif())}</p><div class="drill-host exercise-stage adventure-stage"><section class="board-col"><div class="board-frame"><div class="cg-wrap"></div><div class="promotion-choices" hidden role="dialog" aria-modal="true" aria-label="${t('exercises.promotion')}"></div></div><details class="adventure-readable"><summary>${t('adventure.position')}</summary><p class="adventure-position"></p></details></section><section class="adventure-info"><div class="adventure-rabbit"></div><h2 class="adventure-prompt"></h2><p class="adventure-turn" role="status"></p><p class="adventure-counter"></p><p class="adventure-help-label"></p><p class="adventure-message" role="status"></p><p class="adventure-explanation"></p><div class="actions"><button class="adventure-hint">${t('adventure.hint')}</button><button class="adventure-next primary" hidden>${t('adventure.nextPreparation')}</button></div><form class="adventure-move-form"><label>${t('adventure.moveInput')}<input name="move" autocomplete="off" spellcheck="false" aria-describedby="adventure-move-help"></label><button type="submit">${t('adventure.playMove')}</button><small id="adventure-move-help">${t('adventure.moveHelp')}</small></form><p class="adventure-history"></p>${encounter.opening && isDuel ? `<details><summary>${t('adventure.openingContinuation')}</summary><p class="mono">${encounter.opening.continuation.join(' ')}</p></details>` : ''}${errorsPanel()}</section></div>`
      cg = Chessground(host.querySelector('.cg-wrap'), { coordinates: true, animation: { enabled: !reducedMotion.matches, duration: 120 }, movable: { free: false, events: { after: boardMove } }, premovable: { enabled: false }, drawable: { enabled: true, visible: true } })
      const menu = host.querySelector('.promotion-choices')
      menu.addEventListener('click', (event) => { const code = event.target.closest('button')?.dataset.piece; if (!promotion) return; const move = promotion; promotion = null; menu.hidden = true; if (code) handleMove(move.orig + move.dest + code); else update() })
      menu.addEventListener('keydown', (event) => { if (event.key === 'Escape') { promotion = null; menu.hidden = true; update() } })
      host.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault(); keyboard = true
        if (!canPlay()) return
        const input = event.target.elements.move
        const chess = chessOf()
        let move
        try { move = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(input.value.trim()) ? playUci(chess, input.value.trim()) : chess.move(input.value.trim()) } catch {}
        if (!move) { message = t('adventure.illegal'); update(); return }
        input.value = ''; handleMove(move.from + move.to + (move.promotion || ''))
      })
    }
    const slot = host.querySelector('.adventure-rabbit')
    if (slot) companion = mountCompanion(slot, ctx, { collection })
    for (const [selector, action] of [['.adventure-start', () => start()], ['.adventure-replay', () => start()], ['.adventure-retry-duel', () => start(true)], ['.adventure-next', nextPreparation], ['.adventure-retry-save', flush], ['.adventure-retry-engine', () => { error = null; (retryWork || advance)() }], ['.adventure-hint', hint]]) host.querySelector(selector)?.addEventListener('click', action)
    if (checkpoint.phase === 'result') companion?.react({ type: 'duel', confirmed: true, result: checkpoint.result, final: true, scope: scope() })
    update()
  }
  function playerColor() { return checkpoint.phase === 'duel' || opening() ? side : data()?.initialFen.split(' ')[1] }
  function canPlay() { return !busy && !pending && !error && !data()?.done && (checkpoint.phase !== 'duel' || checkpoint.duel.stage === 'player') && chessOf().turn() === playerColor() }
  function update() {
    if (destroyed) return
    controls()
    if (!cg) return
    const chess = chessOf()
    const own = canPlay()
    const dests = new Map()
    if (own) for (const move of chess.moves({ verbose: true })) { if (!dests.has(move.from)) dests.set(move.from, []); dests.get(move.from).push(move.to) }
    cg.set({ fen: chess.fen(), orientation: playerColor() === 'w' ? 'white' : 'black', turnColor: chess.turn() === 'w' ? 'white' : 'black', check: chess.inCheck(), movable: { color: own ? (playerColor() === 'w' ? 'white' : 'black') : undefined, dests } })
    const isDuel = checkpoint.phase === 'duel'
    const prep = checkpoint.preparationState
    host.querySelector('.adventure-prompt').textContent = isDuel ? t(`adventure.goal.${encounter.goal}`) : opening() ? prep.done ? t('adventure.opening') : t('adventure.openingNext', { move: encounter.opening.preparation[prep.index] || '' }) : t('exercises.moveQuestion')
    host.querySelector('.adventure-turn').textContent = error || data().done ? '' : busy || !own ? t(isDuel && checkpoint.duel.stage === 'verify' ? 'adventure.checking' : 'adventure.thinking') : `${t('adventure.side', { side: t(`side.${playerColor() === 'w' ? 'white' : 'black'}`) })} ${t('adventure.yourTurn')}`
    host.querySelector('.adventure-message').textContent = message
    host.querySelector('.adventure-help-label').textContent = checkpoint.aided ? t('adventure.assisted') : isDuel && ctx.getAdventure().encounters[encounter.id].failures >= 2 ? t('adventure.helpOffer') : ''
    host.querySelector('.adventure-counter').textContent = isDuel ? t('adventure.rounds', { count: chess.history({ verbose: true }).filter((move) => move.color === side).length, limit: encounter.goal === 'defense' ? 4 : 6 }) : ''
    const next = host.querySelector('.adventure-next'); next.hidden = isDuel || !prep?.done; next.textContent = t(checkpoint.preparationIndex === 2 ? 'adventure.startDuel' : 'adventure.nextPreparation')
    const hintButton = host.querySelector('.adventure-hint'); hintButton.hidden = isDuel ? ctx.getAdventure().encounters[encounter.id].failures < 2 : prep.done; hintButton.disabled ||= !own
    for (const input of host.querySelectorAll('form input, form button')) input.disabled = !own
    host.querySelector('.adventure-explanation').textContent = !isDuel && prep.done ? opening() ? `${t('adventure.openingDone')} ${prep.idea || ''}` : t('exercises.explanation', { motif: encounter.theme === 'advantage' && primaryTheme(puzzle()) ? t(`theme.${primaryTheme(puzzle())}`) : motif(), solution: solutionLine(puzzle()) }) : !isDuel && opening() ? prep.idea || '' : ''
    host.querySelector('.adventure-history').textContent = `${t('adventure.moves')} : ${chess.history().join(' ')}`
    const pieces = chess.board().flat().filter(Boolean)
    host.querySelector('.adventure-position').textContent = ['w', 'b'].map((color) => `${t(`side.${color === 'w' ? 'white' : 'black'}`)} : ${pieces.filter((piece) => piece.color === color).map((piece) => `${t(`adventure.piece.${piece.type}`)} ${piece.square}`).join(', ')}`).join('. ')
    if (own && keyboard) host.querySelector('form input').focus({ preventScroll: true })
    if (prep?.done && !isDuel && keyboard) next.focus({ preventScroll: true })
  }
  function expected(chess, prep = checkpoint.preparationState) {
    if (opening()) {
      const move = chess.move(encounter.opening.preparation[prep.index])
      return move.from + move.to + (move.promotion || '')
    }
    return puzzle().moves[prep.index]
  }
  function attemptStats(next) {
    if (opening()) return null
    const item = puzzle(), prep = next.preparationState
    return { ref: item.id, result: prep.result, errors: prep.errors, aided: prep.hints > 0, ms: Math.max(0, Date.now() - prep.startedAt), rating: item.rating, cat: item.cat, theme: encounter.theme === 'advantage' ? primaryTheme(item) : encounter.theme, packVersion: checkpoint.packVersion }
  }
  function finishPreparation(next, solved) {
    next.preparationState.done = true
    next.preparationState.result = solved ? 'solved' : 'failed'
    return commit(next, attemptStats(next), () => {
      message = t(solved ? 'companion.solved' : 'exercises.reveal')
      companion?.react({ type: 'puzzle', resolved: true, result: solved ? 'solved' : 'failed', scope: scope() })
      sound.play(solved ? 'success' : 'error', { sounds: state.settings.sounds })
      update()
    })
  }
  function boardMove(orig, dest) {
    keyboard = false
    if (!canPlay()) { update(); return }
    const chess = chessOf()
    if (chess.get(orig)?.type === 'p' && ['1', '8'].includes(dest[1])) {
      promotion = { orig, dest }
      showPromotion(host.querySelector('.promotion-choices'), { dest, color: playerColor(), orientation: playerColor() === 'w' ? 'white' : 'black', t })
    } else handleMove(orig + dest)
  }
  async function handleMove(uci) {
    if (!canPlay()) return
    sound.unlock()
    const chess = chessOf(), before = chessOf()
    const move = playUci(chess, uci)
    if (!move) { message = t('adventure.illegal'); update(); return }
    cg.setAutoShapes([])
    const next = snapshot()
    if (checkpoint.phase === 'duel') {
      next.duel.moves.push(uci); next.duel.stage = 'engine'; message = ''
      await commit(next, null, () => {
        companion?.react({ type: 'move', captured: move.captured, promotion: move.promotion, check: chess.inCheck(), checkmate: chess.isCheckmate(), duel: true, scope: scope() })
        sound.play(move.captured ? 'capture' : 'move', { sounds: state.settings.sounds })
        return advance()
      })
      return
    }
    const prep = next.preparationState
    const correct = uci === expected(before) || !opening() && puzzle().themes.includes('mateIn1') && chess.isCheckmate()
    if (!correct) {
      prep.errors++
      message = t('exercises.tryAgain')
      if (prep.errors >= 3) { await finishPreparation(next, false); return }
      await commit(next, null, () => sound.play('error', { sounds: state.settings.sounds }))
      return
    }
    prep.moves.push(uci); prep.index++; message = ''
    if (opening()) prep.idea = textOf(encounter.opening.ideas?.[prep.index - 1], locale) || t('exercises.good', { move: move.san })
    const count = opening() ? encounter.opening.preparation.length : puzzle().moves.length
    if (prep.index >= count || chess.isGameOver()) { await finishPreparation(next, true); return }
    await commit(next, null, async () => {
      if (opening() && prep.idea) companion?.react({ type: 'opening', resolved: true, detail: prep.idea, scope: scope() })
      await advance()
    })
  }
  async function advance() {
    if (destroyed || busy || pending || error || !cg) return
    if (checkpoint.phase === 'preparation') {
      const chess = chessOf(), prep = checkpoint.preparationState
      if (prep.done || chess.turn() === playerColor()) { update(); return }
      const uci = expected(chessOf())
      const move = playUci(chess, uci)
      if (!move) { error = 'history'; update(); return }
      const next = snapshot(); next.preparationState.moves.push(uci); next.preparationState.index++
      const count = opening() ? encounter.opening.preparation.length : puzzle().moves.length
      if (next.preparationState.index >= count || chess.isGameOver()) { await finishPreparation(next, true); return }
      await commit(next)
      return
    }
    if (checkpoint.phase !== 'duel') return
    let chess = chessOf()
    const terminal = evaluateDuel({ ...checkpoint.duel, side: encounter.side, goal: encounter.goal })
    if (['won', 'lost'].includes(terminal.status)) { await finishDuel(terminal); return }
    if (checkpoint.duel.stage === 'player') { update(); return }
    busy = true; update()
    companion?.react({ type: 'thinking', scope: scope(), duel: true })
    try {
      if (checkpoint.duel.stage === 'engine') {
        const reply = await platform.engine.bestMove(chess.fen(), { elo: state.settings.elo, signal: abort.signal })
        if (destroyed) return
        if (!reply || !playUci(chess, reply)) throw new Error('invalid engine move')
        const next = snapshot(); next.duel.moves.push(reply); next.duel.stage = 'verify'
        busy = false
        await commit(next, null, advance)
      } else {
        const lines = await platform.engine.analyse(chess.fen(), { depth: 12, movetime: 500, multipv: 1, priority: 'interactive', signal: abort.signal })
        if (destroyed) return
        const score = lines[0]?.score
        if (!Number.isFinite(score)) throw new Error('missing independent evaluation')
        const next = snapshot(); next.duel.evaluations.push(score); next.duel.stage = 'player'
        const outcome = evaluateDuel({ ...next.duel, side: encounter.side, goal: encounter.goal, score })
        busy = false
        if (['won', 'lost'].includes(outcome.status)) await finishDuel(outcome, next)
        else await commit(next)
      }
    } catch (failure) {
      if (destroyed || failure.name === 'AbortError') return
      busy = false; error = 'engine'; retryWork = advance; update()
    }
  }
  function finishDuel(outcome, next = snapshot()) {
    Object.assign(next, { phase: 'result', result: outcome.status, reason: outcome.reason, gain: outcome.gain, confirmed: true })
    return commit(next)
  }
  async function hint() {
    if (!canPlay() || checkpoint.phase === 'duel' && ctx.getAdventure().encounters[encounter.id].failures < 2) return
    let uci
    if (checkpoint.phase === 'duel') {
      busy = true; update()
      try {
        uci = (await platform.engine.analyse(chessOf().fen(), { depth: 12, movetime: 500, multipv: 1, priority: 'interactive', signal: abort.signal }))[0]?.uci
      } catch (failure) {
        if (!destroyed && failure.name !== 'AbortError') { busy = false; error = 'engine'; retryWork = hint; update() }
        return
      }
      busy = false
    } else uci = expected(chessOf())
    if (destroyed) return
    const chess = chessOf(), move = uci && playUci(chess, uci)
    if (!move) { error = 'engine'; retryWork = hint; update(); return }
    const next = snapshot(); next.aided = true
    if (checkpoint.phase === 'preparation') { next.preparationAided = true; next.preparationState.hints++ }
    await commit(next, null, () => {
      message = t('adventure.hintMove', { move: move.san })
      cg.setAutoShapes([{ orig: move.from, dest: move.to, brush: 'green' }])
      companion?.react({ type: 'hint', requested: true, detail: message, scope: scope(), duel: checkpoint.phase === 'duel' })
      update()
    })
  }

  render()
  ctx.setActions({ next: nextPreparation, hint })
  queueMicrotask(advance)
  return { destroy() { destroyed = true; abort.abort(); reducedMotion.removeEventListener('change', motionChanged); release() } }
}
