// XChess Rush (spec V2 L10) : 3 minutes, 3 vies. Chaque position vient de mes lignes déjà jouées
// (core/game.js : rushPositions, drawRush, pondérés par l'oubli) et je joue le coup de la ligne.
// Juste : +1 point, et +5 s toutes les 5 réponses justes d'affilée. Faux : 1 vie perdue, le bon coup
// s'affiche, et la ligne revient dans la prochaine séance (srs.flagForReview). Coup « aussi valable »
// selon Stockfish (alt) : ni point ni vie perdue, le coup de la ligne s'affiche.
import { Chessground } from 'chessground'
import { Chess } from 'chess.js'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import { selection, openings } from '../data.js'
import { flagForReview } from '../core/srs.js'
import { rushPositions, drawRush, createRng, RUSH } from '../core/game.js'
import { moveLabel } from '../core/lines.js'
import { t } from '../i18n.js'
import { resolveOpening, getCachedLines, escapeHtml } from './shared.js'
import * as sound from './sound.js'

const RECENT = 8 // positions récentes écartées du tirage
const heart = '<svg class="life" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.2 3 4.5 6.6 4.5c2.1 0 3.9 1.2 5.4 3.2 1.5-2 3.3-3.2 5.4-3.2 3.6 0 5.7 3.7 4.2 7.2C19.5 16.4 12 21 12 21z"/></svg>'

function destsOf(chess) {
  const dests = new Map()
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, [])
    dests.get(m.from).push(m.to)
  }
  return dests
}
const fmtTime = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export async function mount(host, ctx) {
  const { state, game, saveProgress, setActions } = ctx
  const locale = state.settings.locale
  const tr = (key, values) => t(locale, key, values)
  host.innerHTML = `<p class="eyebrow"><a href="#/">${tr('today')}</a></p><h1>XChess Rush</h1><p class="empty">${tr('rush.preparing')}</p>`

  const items = []
  for (const id of Object.keys(state.progress)) {
    const opening = resolveOpening(id, { selection, openings })
    if (!opening) continue
    const { lines } = await getCachedLines(opening)
    items.push({ openingId: id, side: opening.side, lines, progress: state.progress[id] || {} })
  }
  const positions = rushPositions(items, Date.now())
  if (positions.length < RUSH.minPositions) {
    host.innerHTML = `
      <p class="eyebrow"><a href="#/">${tr('today')}</a></p><h1>XChess Rush</h1>
      <p class="empty">${tr('rush.locked', { count: positions.length, needed: RUSH.minPositions })}</p>
    `
    setActions({})
    return { destroy() {} }
  }

  host.innerHTML = `
    <div class="rush">
      <header class="rush-top">
        <div><p class="eyebrow"><a href="#/">${tr('today')}</a></p><h1>XChess Rush</h1></div>
        <div class="rush-hud" aria-live="off">
          <span class="rush-time mono" title="${tr('rush.timeRemaining')}">${fmtTime(RUSH.seconds * 1000)}</span>
          <span class="rush-lives" title="${tr('rush.lives')}"></span>
          <span class="rush-score"><b class="mono">0</b> ${tr('rush.points')}</span>
          <span class="rush-streak mono" hidden></span>
        </div>
      </header>
      <div class="drill-host rush-stage">
        <section class="board-col">
          <div class="board-frame"><div class="cg-wrap board"></div></div>
          <div class="board-foot"><span class="line-name"></span></div>
        </section>
        <div class="drill-info">
          <p class="rush-prompt"></p>
          <p class="feedback" data-tone="neutral">${tr('rush.positions', { count: positions.length })}</p>
          <div class="rush-intro">
            <p>${tr('rush.intro', { lives: RUSH.lives })}</p>
            <div class="actions"><button type="button" class="primary btn-go">${tr('rush.start')} <kbd>${tr('rush.enter')}</kbd></button></div>
          </div>
          <div class="rush-end" hidden></div>
        </div>
      </div>
    </div>
  `
  const timeEl = host.querySelector('.rush-time')
  const livesEl = host.querySelector('.rush-lives')
  const scoreEl = host.querySelector('.rush-score b')
  const streakEl = host.querySelector('.rush-streak')
  const promptEl = host.querySelector('.rush-prompt')
  const feedbackEl = host.querySelector('.feedback')
  const introEl = host.querySelector('.rush-intro')
  const endEl = host.querySelector('.rush-end')
  const frame = host.querySelector('.board-frame')
  const lineNameEl = host.querySelector('.line-name')
  const getSounds = () => state.settings.sounds

  const rand = createRng(Date.now() >>> 0)
  const nameCache = new Map()
  const nameOf = (id) => {
    if (!nameCache.has(id)) {
      const opening = resolveOpening(id, { selection, openings })
      nameCache.set(id, (locale === 'fr' ? opening?.name : opening?.lichessName || opening?.name) ?? id)
    }
    return nameCache.get(id)
  }
  const st = { running: false, over: false, busy: false, score: 0, lives: RUSH.lives, streak: 0, endsAt: 0, startedAt: 0, pos: null, chess: null, recent: [], misses: [], timer: null, lastTick: null }
  const timers = new Set()
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn() }, ms); timers.add(id) }

  const cg = Chessground(host.querySelector('.board'), {
    coordinates: true,
    animation: { enabled: true, duration: 100 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    drawable: { enabled: true, visible: true },
    movable: { free: false, showDests: true, events: { after: onBoardMove } },
  })
  const ro = new ResizeObserver((entries) => {
    const r = entries[0]?.contentRect
    if (r && r.width > 0 && r.height > 0) cg.redrawAll()
  })
  ro.observe(frame)

  function paintHud() {
    livesEl.innerHTML = Array.from({ length: RUSH.lives }, (_, i) => `<span class="${i < st.lives ? 'on' : 'off'}">${heart}</span>`).join('')
    livesEl.setAttribute('aria-label', tr(st.lives === 1 ? 'rush.lifeOne' : 'rush.lifeCount', { count: st.lives }))
    scoreEl.textContent = st.score
    streakEl.hidden = st.streak < 3
    streakEl.textContent = tr('rush.streak', { count: st.streak })
  }
  function setFeedback(tone, text) {
    feedbackEl.dataset.tone = tone
    feedbackEl.textContent = text
  }
  function float(text, tone = 'good') {
    const el = document.createElement('span')
    el.className = 'xp-float'
    el.dataset.tone = tone
    el.textContent = text
    frame.append(el)
    setTimeout(() => el.remove(), 1100)
  }
  function flash(kind) {
    frame.classList.remove('flash-bad', 'flash-good')
    void frame.offsetWidth
    frame.classList.add(`flash-${kind}`)
  }

  function tick() {
    const left = st.endsAt - Date.now()
    timeEl.textContent = fmtTime(left)
    timeEl.dataset.low = String(left <= 10000)
    const sec = Math.ceil(left / 1000)
    if (left <= 10000 && sec !== st.lastTick && sec > 0) { st.lastTick = sec; sound.play('tick', { sounds: getSounds() }) }
    if (left <= 0) end('temps')
  }

  function next() {
    const pos = drawRush(positions, rand, new Set(st.recent))
    st.recent = [...st.recent, pos.key].slice(-RECENT)
    st.pos = pos
    const chess = new Chess()
    for (const san of pos.moves.slice(0, pos.ply)) chess.move(san)
    st.chess = chess
    const last = chess.history({ verbose: true }).at(-1)
    cg.set({
      orientation: pos.side,
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      check: chess.inCheck(),
      lastMove: last ? [last.from, last.to] : undefined,
      movable: { color: pos.side, dests: destsOf(chess) },
    })
    cg.setAutoShapes([])
    promptEl.innerHTML = `<b>${escapeHtml(nameOf(pos.openingId))}</b><span class="mono">${last ? tr('rush.afterMove', { move: moveLabel(pos.ply - 1, last.san) }) : tr('rush.firstMove')}</span>`
    lineNameEl.textContent = tr('rush.yourMove', { number: Math.floor(pos.ply / 2) + 1 })
    st.busy = false
  }

  function showExpected(brush = 'green') {
    const exp = new Chess(st.chess.fen()).move(st.pos.moves[st.pos.ply])
    cg.set({ fen: st.chess.fen(), movable: { color: undefined, dests: new Map() } })
    cg.setAutoShapes([{ orig: exp.from, dest: exp.to, brush }])
    return exp
  }

  function onBoardMove(orig, dest) {
    if (!st.running || st.busy) return
    sound.unlock()
    let mv
    try { mv = st.chess.move({ from: orig, to: dest, promotion: 'q' }) } catch { return }
    const expected = st.pos.moves[st.pos.ply]
    st.busy = true
    if (mv.san === expected) {
      st.score++
      st.streak++
      sound.play(mv.captured ? 'capture' : 'move', { sounds: getSounds() })
      flash('good')
      float('+1')
      if (st.streak % RUSH.bonusEvery === 0) {
        st.endsAt += RUSH.bonusSeconds * 1000
        later(() => float(`+${RUSH.bonusSeconds} s`, 'bonus'), 200)
        sound.play('combo', { sounds: getSounds(), level: st.streak })
      }
      setFeedback('good', tr('rush.correct', { move: mv.san }))
      paintHud()
      later(next, 220)
      return
    }
    st.chess.undo()
    if (st.pos.alts.includes(mv.san)) {
      const exp = showExpected('paleGreen')
      setFeedback('warn', tr('rush.alsoValid', { played: mv.san, expected: exp.san }))
      later(next, 1100)
      return
    }
    st.lives--
    st.streak = 0
    sound.play('error', { sounds: getSounds() })
    flash('bad')
    const exp = showExpected()
    st.misses.push({ openingId: st.pos.openingId, lineId: st.pos.lineId, ply: st.pos.ply, played: mv.san, expected: exp.san })
    setFeedback('bad', tr('rush.wrong', { played: mv.san, expected: exp.san }))
    paintHud()
    later(() => (st.lives <= 0 ? end('vies') : next()), 1100)
  }

  function start() {
    if (st.running) return
    sound.unlock()
    Object.assign(st, { running: true, over: false, score: 0, lives: RUSH.lives, streak: 0, misses: [], recent: [], lastTick: null })
    st.startedAt = Date.now()
    st.endsAt = st.startedAt + RUSH.seconds * 1000
    introEl.hidden = true
    endEl.hidden = true
    setFeedback('neutral', tr('rush.yourTurn'))
    paintHud()
    st.timer = setInterval(tick, 100)
    tick()
    next()
  }

  async function end(reason) {
    if (!st.running) return
    st.running = false
    st.over = true
    clearInterval(st.timer)
    for (const id of timers) clearTimeout(id)
    timers.clear()
    cg.set({ movable: { color: undefined, dests: new Map() } })
    sound.play('rushEnd', { sounds: getSounds() })
    const res = game?.recordRush({ score: st.score, errors: st.misses.length, ms: Date.now() - st.startedAt }) ?? { xp: 0, record: false }
    // Erreurs : chaque ligne ratée revient dans la prochaine séance, sans perdre sa boîte.
    const byOpening = new Map()
    for (const m of st.misses) {
      const prog = byOpening.get(m.openingId) || state.progress[m.openingId] || {}
      byOpening.set(m.openingId, flagForReview(prog, m.lineId, m.ply, Date.now()))
    }
    for (const [openingId, prog] of byOpening) await saveProgress(openingId, prog)
    timeEl.textContent = fmtTime(Math.max(0, st.endsAt - Date.now()))
    setFeedback('neutral', tr(reason === 'temps' ? 'rush.timeUp' : 'rush.outOfLives'))
    endEl.hidden = false
    endEl.innerHTML = `
      <p class="rush-final"><b class="mono">${st.score}</b> ${tr(st.score === 1 ? 'rush.point' : 'rush.points')}${res.record ? `<span class="record">${tr('rush.newRecord')}</span>` : ''}</p>
      <p class="muted">${tr('rush.finalXp', { xp: res.xp })}${res.record ? tr('rush.recordBonus') : '.'}</p>
      ${st.misses.length ? `<p class="muted">${tr('rush.review')}</p><ul class="rush-misses">${st.misses.map((m) => `<li><b>${escapeHtml(nameOf(m.openingId))}</b> <span class="mono">${moveLabel(m.ply, m.expected)}</span> <small>${tr('rush.played', { move: escapeHtml(m.played) })}</small></li>`).join('')}</ul>` : `<p class="muted">${tr('rush.noMistakes')}</p>`}
      <div class="actions"><button type="button" class="primary btn-again">${tr('rush.playAgain')} <kbd>${tr('rush.enter')}</kbd></button><a class="cta" href="#/">${tr('today')}</a></div>
    `
    endEl.querySelector('.btn-again').addEventListener('click', start)
  }

  function onKey(e) {
    if (e.key !== 'Enter' || st.running) return
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    e.preventDefault()
    start()
  }
  document.addEventListener('keydown', onKey)
  host.querySelector('.btn-go').addEventListener('click', start)
  setActions({})
  paintHud()

  return {
    destroy() {
      clearInterval(st.timer)
      for (const id of timers) clearTimeout(id)
      document.removeEventListener('keydown', onKey)
      ro.disconnect()
      cg.destroy()
    },
  }
}
