import { Chessground } from 'chessground'
import { Chess } from 'chess.js'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import './scene.css'
import { choiceFrom, choiceParams, rabbitUrl, reactions } from './model.js'

const isBaseline = new URLSearchParams(location.search).get('baseline') === '1'
let choice = choiceFrom(new URLSearchParams(location.search))
const chess = new Chess()
for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5']) chess.move(move)
const boardElement = document.querySelector('.board')
const cg = Chessground(boardElement, {
  fen: chess.fen(), orientation: 'white', coordinates: true,
  viewOnly: true, animation: { enabled: false },
  drawable: { enabled: false, visible: true },
  highlight: { lastMove: false, check: false },
})

let measurementFrame = null
function measure() {
  if (measurementFrame !== null) return
  // Chessground rounds the grid to complete pixel squares. Measure the 64 squares,
  // rather than the wrapper. Its own ResizeObserver handles geometry; redrawAll()
  // would replace the measured node and install another internal observer.
  measurementFrame = requestAnimationFrame(() => {
    measurementFrame = null
    const rect = boardElement.querySelector('cg-board').getBoundingClientRect()
    if (rect.width > 0) parent.postMessage({ type: 'white-rabbit-measure', width: rect.width, height: rect.height, viewport: innerWidth }, location.origin)
  })
}

function render() {
  const reaction = reactions.find((item) => item.id === choice.reaction)
  document.body.className = `theme-${isBaseline ? 'current' : choice.board}`
  document.body.classList.toggle('baseline', isBaseline)
  document.body.classList.toggle('animate', choice.motion)
  document.body.dataset.reaction = choice.reaction
  document.querySelector('#rabbit').src = rabbitUrl(choice)
  document.querySelector('#rabbit').classList.toggle('pixel', choice.style === 'pixel')
  document.querySelector('#reaction-title').textContent = reaction.title
  document.querySelector('#reaction-text').textContent = reaction.text
  document.querySelector('#reaction-mark').textContent = reaction.mark
  cg.set({ drawable: { autoShapes: choice.reaction === 'hint' && !isBaseline ? [{ orig: 'f3', brush: 'yellow' }] : [] } })
  measure()
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.type !== 'white-rabbit-choice' || typeof event.data.params !== 'string') return
  choice = choiceFrom(new URLSearchParams(event.data.params))
  render()
})
function setReaction(reaction) {
  const params = choiceParams({ ...choice, reaction })
  // Route iframe actions through the parent's existing, whitelisted controls.
  if (parent !== window) parent.postMessage({ type: 'white-rabbit-reaction', reaction }, location.origin)
  else { choice = choiceFrom(params); render() }
}
document.querySelector('#hint').addEventListener('click', () => setReaction('hint'))
document.querySelector('#reset').addEventListener('click', () => setReaction('waiting'))
new ResizeObserver(measure).observe(document.querySelector('.board-frame'))
window.addEventListener('pagehide', () => cg.destroy(), { once: true })
render()
parent.postMessage({ type: 'white-rabbit-ready' }, location.origin)
