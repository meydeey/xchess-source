import { Chessground } from 'chessground'
import { Chess } from 'chess.js'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import * as sound from './sound.js'
import { showPromotion } from './promotion.js'

function destinations(chess) {
  const result = new Map()
  for (const move of chess.moves({ verbose: true })) {
    if (!result.has(move.from)) result.set(move.from, [])
    result.get(move.from).push(move.to)
  }
  return result
}

export function mount(host, ctx) {
  const { t, state, setActions } = ctx
  host.innerHTML = `
    <div class="arena-page">
      <header class="exercise-head">
        <div><p class="eyebrow"><a href="#/exercises">${t('exercises.title')}</a></p><h1>${t('arena.title')}</h1></div>
      </header>
      <div class="drill-host arena-stage">
        <section class="board-col">
          <div class="board-frame"><div class="cg-wrap board"></div><div class="promotion-choices" role="dialog" aria-modal="true" hidden aria-label="${t('exercises.promotion')}"></div></div>
          <div class="board-foot">${t('arena.boardHelp')}</div>
        </section>
        <section class="drill-info exercise-info arena-info">
          <p class="eyebrow">${t('arena.solo')}</p>
          <h2 class="arena-status" role="status"></h2>
          <div class="actions arena-actions">
            <button type="button" class="arena-undo">${t('arena.undo')}</button>
            <button type="button" class="arena-reset">${t('arena.reset')}</button>
            <button type="button" class="arena-flip">${t('arena.flip')}</button>
          </div>
          <h3>${t('arena.moves')}</h3>
          <p class="arena-moves mono"></p>
          <details class="arena-fen">
            <summary>${t('arena.fen')}</summary>
            <label for="arena-fen-input">${t('arena.fenHelp')}</label>
            <input id="arena-fen-input" type="text" spellcheck="false" autocomplete="off">
            <button type="button" class="arena-load">${t('arena.load')}</button>
            <p class="arena-fen-error" role="alert" hidden></p>
          </details>
        </section>
      </div>
    </div>`
  let chess = new Chess()
  let orientation = 'white'
  let lastMove = null
  let initialPly = 0
  let pendingPromotion = null
  const frame = host.querySelector('.board-frame')
  const board = host.querySelector('.board')
  const statusEl = host.querySelector('.arena-status')
  const movesEl = host.querySelector('.arena-moves')
  const fenEl = host.querySelector('#arena-fen-input')
  const fenErrorEl = host.querySelector('.arena-fen-error')
  const promotionEl = host.querySelector('.promotion-choices')
  const undoEl = host.querySelector('.arena-undo')
  const cg = Chessground(board, {
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

  function status() {
    const side = t(chess.turn() === 'w' ? 'side.white' : 'side.black')
    if (chess.isCheckmate()) return t('arena.checkmate', { side: t(chess.turn() === 'w' ? 'side.black' : 'side.white') })
    if (chess.isDraw()) return t('arena.draw')
    if (chess.inCheck()) return t('arena.check', { side })
    return t('arena.toMove', { side })
  }
  function render() {
    const color = chess.turn() === 'w' ? 'white' : 'black'
    cg.set({
      fen: chess.fen(), orientation, turnColor: color, check: chess.inCheck(), lastMove,
      movable: { color: chess.isGameOver() || pendingPromotion ? undefined : color, dests: chess.isGameOver() || pendingPromotion ? new Map() : destinations(chess) },
    })
    statusEl.textContent = status()
    const moves = chess.history()
    movesEl.textContent = moves.length ? moves.map((san, index) => {
      const ply = initialPly + index
      return `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'} ${san}`
    }).join('  ') : t('arena.noMoves')
    undoEl.disabled = moves.length === 0
    fenEl.value = chess.fen()
    fenErrorEl.hidden = true
  }
  function play(orig, dest, promotion) {
    try {
      const move = chess.move({ from: orig, to: dest, promotion })
      if (!move) { render(); return }
      lastMove = [move.from, move.to]
      sound.play('move', { sounds: state.settings.sounds })
    } catch { /* Chessground restores the legal position below. */ }
    render()
  }
  function onBoardMove(orig, dest) {
    if (pendingPromotion) return
    sound.unlock()
    const piece = chess.get(orig)
    if (piece?.type === 'p' && (dest[1] === '1' || dest[1] === '8')) {
      pendingPromotion = { orig, dest }
      showPromotion(promotionEl, { dest, color: piece.color, orientation, t })
      return
    }
    play(orig, dest)
  }
  promotionEl.addEventListener('click', (event) => {
    const code = event.target.closest('button')?.dataset.piece
    if (!pendingPromotion) return
    if (!code) { pendingPromotion = null; promotionEl.hidden = true; render(); return }
    const { orig, dest } = pendingPromotion
    pendingPromotion = null
    promotionEl.hidden = true
    play(orig, dest, code)
  })
  promotionEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !pendingPromotion) return
    pendingPromotion = null
    promotionEl.hidden = true
    render()
  })
  undoEl.addEventListener('click', () => {
    if (pendingPromotion) { pendingPromotion = null; promotionEl.hidden = true; render(); return }
    if (!chess.undo()) return
    const previous = chess.history({ verbose: true }).at(-1)
    lastMove = previous ? [previous.from, previous.to] : null
    render()
  })
  host.querySelector('.arena-reset').addEventListener('click', () => {
    chess = new Chess()
    initialPly = 0
    lastMove = null
    pendingPromotion = null
    promotionEl.hidden = true
    render()
    frame.scrollIntoView({ block: 'center', behavior: 'auto' })
  })
  host.querySelector('.arena-flip').addEventListener('click', () => {
    orientation = orientation === 'white' ? 'black' : 'white'
    render()
  })
  host.querySelector('.arena-load').addEventListener('click', () => {
    try {
      const candidate = new Chess(fenEl.value.trim())
      chess = candidate
      initialPly = (Number(chess.fen().split(' ')[5]) - 1) * 2 + (chess.turn() === 'b' ? 1 : 0)
      lastMove = null
      pendingPromotion = null
      promotionEl.hidden = true
      render()
      frame.scrollIntoView({ block: 'center', behavior: 'auto' })
    } catch {
      fenErrorEl.textContent = t('arena.invalidFen')
      fenErrorEl.hidden = false
    }
  })
  setActions({})
  render()
  return { destroy() { ro.disconnect(); cg.destroy() } }
}
