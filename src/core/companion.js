// Only verified chess/session facts reach this selector. It never evaluates a position.
export function reactionFor(facts = {}, preferences = {}) {
  let pose = 'idle'
  let key = null
  let values = {}
  if (facts.type === 'thinking') pose = 'thinking'
  if (facts.type === 'puzzle' && facts.resolved) {
    pose = facts.result === 'solved' ? 'joy' : 'encouragement'
    key = facts.result === 'solved' ? 'companion.solved' : 'companion.retry'
  }
  if (facts.type === 'line' && facts.resolved) {
    pose = facts.errors ? 'encouragement' : 'joy'
    key = facts.errors ? 'companion.lineRetry' : 'companion.lineDone'
  }
  if (facts.type === 'opening' && facts.resolved) { pose = 'joy'; key = 'companion.hint'; values = { detail: String(facts.detail || '') } }
  if (facts.type === 'game' && facts.resolved && ['won', 'lost', 'draw'].includes(facts.result)) {
    pose = facts.result === 'won' ? 'victory' : 'encouragement'
    key = `companion.game.${facts.result}`
  }
  if (facts.type === 'hint' && facts.requested) {
    pose = 'thinking'
    key = 'companion.hint'
    values = { detail: String(facts.detail || '') }
  }
  if (facts.type === 'move') {
    if (facts.checkmate) { pose = 'victory'; key = 'companion.mate' }
    else if (facts.promotion) { pose = 'surprise'; key = 'companion.promotion' }
    else if (facts.captured) { pose = 'joy'; key = 'companion.capture' }
    else if (facts.check) { pose = 'thinking'; key = 'companion.check' }
  }
  if (facts.type === 'duel' && facts.confirmed) {
    pose = facts.result === 'won' ? 'victory' : 'encouragement'
    key = facts.result === 'won' ? 'companion.won' : 'companion.retry'
  }
  const visible = preferences.visible !== false
  return { visible, pose, key: visible && preferences.comments !== false ? key : null, values }
}

export function factsForMove(chess, move, extra = {}) {
  const last = chess.history({ verbose: true }).at(-1)
  if (!move || !last || last.from !== move.from || last.to !== move.to || last.promotion !== move.promotion) return { ...extra, type: 'unknown' }
  return { ...extra, type: 'move', captured: last.captured || null, promotion: last.promotion || null, check: chess.inCheck(), checkmate: chess.isCheckmate() }
}
