import { test, expect } from 'bun:test'
import { Chess } from 'chess.js'
import { reactionFor, factsForMove } from '../src/core/companion.js'

test('never reveals a pedagogical comment during an unresolved puzzle', () => {
  expect(reactionFor({ type: 'puzzle', result: 'solved', resolved: false, detail: 'Nxf7 wins' }).key).toBeNull()
  expect(reactionFor({ type: 'thinking', detail: 'Nxf7 wins' })).toMatchObject({ pose: 'thinking', key: null })
  expect(reactionFor({ type: 'hint', requested: false, detail: 'Nxf7' }).key).toBeNull()
})
test('uses resolved facts and an explicit request for hints', () => {
  expect(reactionFor({ type: 'puzzle', result: 'solved', resolved: true })).toMatchObject({ pose: 'joy', key: 'companion.solved' })
  expect(reactionFor({ type: 'puzzle', result: 'failed', resolved: true })).toMatchObject({ pose: 'encouragement', key: 'companion.retry' })
  expect(reactionFor({ type: 'hint', requested: true, detail: 'Look at f7' })).toMatchObject({ pose: 'thinking', key: 'companion.hint', values: { detail: 'Look at f7' } })
  expect(reactionFor({ type: 'duel', result: 'won', confirmed: false }).key).toBeNull()
  expect(reactionFor({ type: 'duel', result: 'won', confirmed: true })).toMatchObject({ pose: 'victory', key: 'companion.won' })
})
test('presence and comments are independent, unknown facts stay quiet', () => {
  expect(reactionFor({ type: 'puzzle', result: 'solved', resolved: true }, { visible: false })).toMatchObject({ visible: false, key: null })
  expect(reactionFor({ type: 'puzzle', result: 'solved', resolved: true }, { comments: false })).toMatchObject({ visible: true, pose: 'joy', key: null })
  expect(reactionFor({ type: 'unknown' })).toMatchObject({ pose: 'idle', key: null })
})

test('opening explanations require a resolved move and game outcomes stay factual', () => {
  expect(reactionFor({ type: 'opening', detail: 'The pawn occupies e4.', resolved: false }).key).toBeNull()
  expect(reactionFor({ type: 'opening', detail: 'The pawn occupies e4.', resolved: true })).toMatchObject({ pose: 'joy', key: 'companion.hint', values: { detail: 'The pawn occupies e4.' } })
  expect(reactionFor({ type: 'game', resolved: true, result: 'draw' })).toMatchObject({ pose: 'encouragement', key: 'companion.game.draw' })
})


test('move facts are taken from the actual board, including captures and mate, and reject undone moves', () => {
  const chess = new Chess()
  chess.move('e4'); chess.move('d5')
  const capture = chess.move('exd5')
  expect(factsForMove(chess, capture)).toMatchObject({ captured: 'p', promotion: null, check: false, checkmate: false })
  chess.undo()
  expect(factsForMove(chess, capture).type).toBe('unknown')
  const mate = new Chess()
  for (const move of ['f3', 'e5', 'g4']) mate.move(move)
  const last = mate.move('Qh4#')
  expect(factsForMove(mate, last)).toMatchObject({ checkmate: true, check: true })
})
