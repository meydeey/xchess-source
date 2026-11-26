import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import '../coach.css'
import '../visual-home.css'
import { selection } from '../data.js'
import { resolveLocale } from '../i18n.js'
import { homeVisualMessages } from '../i18n-home-visual.js'
import * as sound from './sound.js'
import { escapeHtml } from './shared.js'

export const FIRST_OPENING_ID = 'partie-italienne'
const opening = selection.find(({ id }) => id === FIRST_OPENING_ID)
const position = new Chess()
for (const move of opening.moves.slice(0, 4)) position.move(move)
const firstMove = position.moves({ verbose: true }).find(({ san }) => san === opening.moves[4])
const initialPosition = position.fen()
const learnedPosition = firstMove.after

function boardAt(board, options) {
  return Chessground(board, {
    fen: initialPosition,
    orientation: 'white',
    turnColor: 'white',
    coordinates: true,
    animation: { enabled: !matchMedia('(prefers-reduced-motion: reduce)').matches, duration: 100 },
    premovable: { enabled: false },
    drawable: { enabled: false, visible: false },
    ...options,
  })
}

export function mount(host, { state, setActions, t }) {
  const words = homeVisualMessages[resolveLocale(state.settings.locale)]
  setActions({})
  host.classList.add('coach-opening')
  host.innerHTML = `
    <header class="home-lesson-heading">
      <a class="coach-back" href="#/"><span aria-hidden="true">‹</span> ${escapeHtml(words.home)}</a>
      <h1 id="coach-title">${t('coach.italian')}</h1>
    </header>
    <section class="coach-grid home-lesson-grid" aria-labelledby="coach-title">
      <div class="coach-board">
        <div class="board-frame"><div class="cg-wrap board" role="img" aria-label="${escapeHtml(t('coach.position'))}"></div></div>
        <p class="coach-notation mono">${t('coach.italianSequence')}</p>
      </div>
      <div class="coach-copy">
        <p class="coach-lead">${t('coach.playPrompt')}</p>
        <div class="coach-controls">
          <div class="actions coach-moves" role="group" aria-label="${escapeHtml(t('coach.chooseMove'))}">
            ${['b5', 'c4', 'e2'].map((square) => `<button type="button" data-destination="${square}">${t('coach.bishopMove', { square })}</button>`).join('')}
          </div>
          <button type="button" class="link coach-hint">${t('session.hint')}</button>
        </div>
        <p class="coach-feedback" role="status"></p>
        <div class="actions coach-finished" hidden>
          <a class="cta primary" href="#/opening/${FIRST_OPENING_ID}">${t('coach.continueItalian')}</a>
        </div>
      </div>
    </section>
  `
  const copy = host.querySelector('.coach-lead')
  const controls = host.querySelector('.coach-controls')
  const feedback = host.querySelector('.coach-feedback')
  const finished = host.querySelector('.coach-finished')
  const boardHost = host.querySelector('.board')
  let complete = false
  const dests = new Map([[firstMove.from, position.moves({ square: firstMove.from, verbose: true }).map(({ to }) => to)]])
  const board = boardAt(boardHost, {
    highlight: { lastMove: true },
    movable: { free: false, color: 'white', dests, events: { after: (_from, to) => play(to) } },
  })

  function play(to) {
    if (complete) return
    const sounds = state.settings.sounds
    if (sounds) sound.unlock()
    if (to !== firstMove.to) {
      board.set({ fen: initialPosition, turnColor: 'white', movable: { color: 'white', dests } })
      feedback.textContent = t('coach.tryAgain')
      sound.play('error', { sounds })
      return
    }
    complete = true
    board.set({ fen: learnedPosition, lastMove: [firstMove.from, firstMove.to], turnColor: 'black', movable: { color: undefined, dests: new Map() } })
    boardHost.setAttribute('aria-label', t('coach.learnedPosition'))
    host.querySelector('.coach-notation').textContent += ` ${t('coach.italianNotation')}`
    copy.textContent = t('coach.italianIdea')
    feedback.textContent = t('coach.correct')
    sound.play('success', { sounds })
    controls.hidden = true
    finished.hidden = false
    finished.querySelector('a').focus({ preventScroll: true })
    setActions({})
  }

  function hint() {
    if (complete) return
    feedback.textContent = t('coach.italianHint')
    board.setAutoShapes([{ orig: firstMove.from, dest: firstMove.to, brush: 'green' }])
  }

  boardHost.addEventListener('pointerdown', () => {
    if (state.settings.sounds) sound.unlock()
  })
  host.querySelector('.coach-moves').addEventListener('click', (event) => {
    const option = event.target.closest('[data-destination]')
    if (option) play(option.dataset.destination)
  })
  host.querySelector('.coach-hint').addEventListener('click', hint)
  setActions({ hint })
  return { destroy() { board.destroy() } }
}
