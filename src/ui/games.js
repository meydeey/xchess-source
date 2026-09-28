import { Chess } from 'chess.js'
import { Chessground } from 'chessground'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import { platform } from '../platform/index.js'
import { analyzeGame, gameFingerprint, parsePgnGames, pgnPlayers, sideForPlayer, topGameDecisions } from '../core/pgn-games.js'
import { escapeHtml } from './shared.js'

const playerOf = (event) => event.data?.side === 'white' ? event.data.white : event.data.black
const importedOf = (events) => {
  const byId = new Map()
  for (const event of events) if (event.kind === 'game' && event.data?.phase === 'imported' && !byId.has(event.data.gameId)) byId.set(event.data.gameId, event)
  return [...byId.values()].sort((a, b) => b.at - a.at)
}

export async function mount(host, ctx) {
  const { t, notify, saveGameFact, getGameEvents, game } = ctx
  const guided = (await ctx.getChallengePath()).focusIndex === 0
  let active = true
  let working = false
  let board = null
  let observer = null
  let selectedDecision = null
  let parsed = null
  let attempts = 0
  let aided = false
  let solvedMove = false
  ctx.setActions({})

  function disposeBoard() { observer?.disconnect(); observer = null; board?.destroy(); board = null }
  const facts = () => getGameEvents()
  const analyses = () => new Map(facts().filter((e) => e.kind === 'game' && e.data?.phase === 'analyzed').map((e) => [e.data.gameId, e]))
  const decisions = () => {
    const imports = new Map(importedOf(facts()).map((e) => [e.data.gameId, e]))
    return [...analyses().values()].flatMap((e) => (e.data.decisions || []).map((d) => ({ ...d, originAt: imports.get(e.data.gameId)?.at || 0, side: imports.get(e.data.gameId)?.data.side })))
  }
  const completed = () => {
    const firstSeen = new Map()
    const retained = new Set()
    for (const e of facts().filter((entry) => entry.kind === 'drill').sort((a, b) => a.at - b.at)) {
      if (!e.data?.ref) continue
      if (!firstSeen.has(e.data.ref)) firstSeen.set(e.data.ref, e.at)
      if (e.data.result === 'solved' && !e.data.errors && !e.data.aided && e.at - firstSeen.get(e.data.ref) >= 86400000) retained.add(e.data.ref)
    }
    return retained
  }

  function shell() {
    disposeBoard()
    const events = facts()
    const imports = importedOf(events)
    const done = analyses()
    const ready = decisions()
    const solved = completed()
    host.innerHTML = `
      <div class="games-page">
        <p class="eyebrow"><a href="#/progress/path">${t('progress.path')}</a></p>
        <h1>${t('games.title')}</h1>
        <p class="thesis">${t('games.thesis')}</p>
        <section class="card games-import">
          <h2>${t('games.import')}</h2>
          <p class="muted">${t('games.importHelp')}</p>
          <button type="button" class="games-file-trigger">${t('games.chooseFile')}</button><input class="games-file" type="file" accept=".pgn,text/plain,application/x-chess-pgn" hidden>
          <div class="games-picker" hidden></div>
          <p class="games-status" role="status"></p>
        </section>
        <section class="card games-practice">
          <header class="card-head"><h2>${t('games.practice')}</h2><span class="muted">${t('games.practiced', { count: solved.size, total: ready.length })}</span></header>
          <p class="muted">${ready.length ? t('games.practiceHelp') : t('games.noDecisions')}</p>
          <div class="games-board"></div>
        </section>
        <section class="card games-list"><h2>${t('games.library')}</h2>
          ${imports.length ? `<ul>${imports.map((e) => `<li><span><b>${escapeHtml(e.data.white || '?')} · ${escapeHtml(e.data.black || '?')}</b><small>${escapeHtml(e.data.date || '')} · ${escapeHtml(playerOf(e) || '')}</small></span><span>${done.has(e.data.gameId) ? t('games.analyzed') : t('games.waiting')}</span></li>`).join('')}</ul>` : `<p class="muted">${t('games.empty')}</p>`}
          ${imports.some((e) => !done.has(e.data.gameId)) ? `<button type="button" class="games-analyze">${t('games.resume')}</button>` : ''}
        </section>
      </div>`
    host.querySelector('.games-file')?.addEventListener('change', onFile)
    host.querySelector('.games-file-trigger')?.addEventListener('click', () => host.querySelector('.games-file')?.click())
    host.querySelector('.games-analyze')?.addEventListener('click', () => analyzePending())
    if (ready.length) showDecision(ready.find((d) => !solved.has(d.ref)) || ready[0])
  }

  async function onFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      parsed = parsePgnGames(await file.text())
      if (!parsed.games.length) throw new Error('games.noValidGames')
      const players = pgnPlayers(parsed.games)
      const picker = host.querySelector('.games-picker')
      picker.hidden = false
      picker.innerHTML = `<label>${t('games.myName')}<select class="games-player">${players.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.count})</option>`).join('')}</select></label><div class="games-unknown"></div><button type="button" class="games-confirm">${t('games.importNow')}</button>`
      picker.querySelector('.games-player').addEventListener('change', showSideChoices)
      showSideChoices()
      picker.querySelector('.games-confirm').addEventListener('click', onImport)
      host.querySelector('.games-status').textContent = t('games.found', { count: parsed.games.length, invalid: parsed.invalid.length })
    } catch (error) { host.querySelector('.games-status').textContent = t(error.message.startsWith('games.') ? error.message : 'games.readError') }
  }

  function showSideChoices() {
    const player = host.querySelector('.games-player')?.value
    const unknown = host.querySelector('.games-unknown')
    if (!unknown || !parsed) return
    unknown.innerHTML = parsed.games.map((candidate, index) => sideForPlayer(candidate, player) ? '' : `<label>${t('games.chooseSide', { white: escapeHtml(candidate.white || '?'), black: escapeHtml(candidate.black || '?') })}<select data-game-index="${index}"><option value="skip">${t('games.skip')}</option><option value="white">${t('side.white')}</option><option value="black">${t('side.black')}</option></select></label>`).join('')
  }

  async function onImport() {
    const player = host.querySelector('.games-player')?.value
    const existing = new Set(importedOf(facts()).map((e) => e.data.gameId))
    let added = 0; let duplicate = 0; let unknown = 0
    try {
      for (const [index, candidate] of parsed.games.entries()) {
        const side = sideForPlayer(candidate, player) || host.querySelector(`.games-unknown select[data-game-index="${index}"]`)?.value
        if (!side || side === 'skip') { unknown++; continue }
        const gameId = await gameFingerprint(candidate)
        if (existing.has(gameId)) { duplicate++; continue }
        await saveGameFact('game', { phase: 'imported', gameId, pgn: candidate.pgn, initialFen: candidate.initialFen, side, white: candidate.white, black: candidate.black, date: candidate.date, site: candidate.site, result: candidate.result })
        existing.add(gameId)
        added++
      }
      shell()
      host.querySelector('.games-status').textContent = t('games.imported', { added, duplicate, unknown })
      if (added) analyzePending()
    } catch (error) { notify(t(error.message.startsWith('games.') ? error.message : 'games.saveError')) }
  }

  async function analyzePending() {
    if (working || !active || document.hidden) return
    working = true
    try {
      for (const entry of importedOf(facts())) {
        if (!active || document.hidden) break
        if (analyses().has(entry.data.gameId)) continue
        const status = host.querySelector('.games-status')
        if (status) status.textContent = t('games.analyzing', { white: entry.data.white, black: entry.data.black })
        const parsedGame = parsePgnGames(entry.data.pgn).games[0]
        if (!parsedGame) continue
        const candidate = { ...parsedGame, gameId: entry.data.gameId }
        const checkpoint = facts().filter((e) => e.kind === 'game' && e.data?.phase === 'checkpoint' && e.data.gameId === entry.data.gameId).sort((a, b) => b.data.nextPly - a.data.nextPly)[0]
        const result = await analyzeGame(candidate, entry.data.side, platform.engine, {
          fromPly: checkpoint?.data.nextPly || 0, previous: checkpoint?.data.decisions || [],
          shouldPause: () => !active || document.hidden,
          onCheckpoint: async (nextPly, partial) => {
            await saveGameFact('game', { phase: 'checkpoint', gameId: entry.data.gameId, nextPly, decisions: topGameDecisions(partial) })
            const label = host.querySelector('.games-status')
            if (label) label.textContent = t('games.progress', { current: nextPly, total: candidate.moves.length })
          },
        })
        if (!result.complete) break
        await saveGameFact('game', { phase: 'analyzed', gameId: entry.data.gameId, decisions: result.decisions, engine: 'Stockfish 19 lite', depth: 14 })
        if (active) shell()
      }
    } catch (error) { if (active) { const status = host.querySelector('.games-status'); if (status) status.textContent = t('games.analysisFailed', { reason: error.message }) } }
    finally { working = false }
  }

  function showDecision(decision) {
    disposeBoard()
    selectedDecision = decision
    attempts = 0; aided = false; solvedMove = false
    if (!facts().some((e) => e.kind === 'drill' && e.data?.ref === decision.ref)) {
      saveGameFact('drill', { ref: decision.ref, gameId: decision.gameId, result: 'seen', errors: 0, aided: false, originAt: decision.originAt })
        .catch((error) => notify(t(error.message.startsWith('games.') ? error.message : 'games.saveError')))
    }
    const spot = host.querySelector('.games-board')
    if (!spot) return
    const chess = new Chess(decision.fen)
    const legalMoves = chess.moves({ verbose: true })
    const dests = new Map()
    for (const move of legalMoves) {
      if (!dests.has(move.from)) dests.set(move.from, [])
      dests.get(move.from).push(move.to)
    }
    spot.innerHTML = `<p class="games-prompt">${decision.mistake ? t('games.rethink') : t('games.findMove')}</p>${guided ? `<p class="games-guided">${t('games.guided')}</p>` : ''}<div class="board-frame"><div class="cg-wrap board"></div></div><div class="games-move-entry"><label>${t('games.move')}<select class="games-move-select">${legalMoves.map((move) => `<option value="${move.from}${move.to}${move.promotion || ''}">${escapeHtml(move.san)}</option>`).join('')}</select></label><button type="button" class="games-play">${t('games.play')}</button></div><p class="games-feedback" role="status"></p><div class="games-actions"><button type="button" class="games-hint">${t('games.hint')}</button><button type="button" class="games-next">${t('games.next')}</button></div>`
    board = Chessground(spot.querySelector('.board'), {
      fen: decision.fen, orientation: decision.side, coordinates: true,
      animation: { enabled: true, duration: 100 },
      movable: { free: false, color: decision.side, showDests: true, dests, events: { after: onMove } },
    })
    observer = new ResizeObserver(() => board?.redrawAll())
    observer.observe(spot.querySelector('.board-frame'))
    spot.querySelector('.games-hint').addEventListener('click', () => {
      aided = true
      spot.querySelector('.games-feedback').textContent = t('games.hintMove', { square: decision.accepted[0]?.slice(0, 2) || '?' })
    })
    spot.querySelector('.games-next').addEventListener('click', nextDecision)
    spot.querySelector('.games-play').addEventListener('click', () => {
      const uci = spot.querySelector('.games-move-select').value
      onMove(uci.slice(0, 2), uci.slice(2, 4), uci[4])
    })
  }

  async function onMove(from, to, promotion = null) {
    if (solvedMove) return
    const decision = selectedDecision
    const spot = host.querySelector('.games-board')
    const chess = new Chess(decision.fen)
    const wanted = decision.accepted.find((uci) => uci.startsWith(`${from}${to}`))
    const legal = chess.move({ from, to, promotion: promotion || wanted?.[4] || 'q' })
    if (!legal) { board?.set({ fen: decision.fen }); return }
    const uci = `${from}${to}${legal.promotion || ''}`
    if (!decision.accepted.includes(uci)) {
      attempts++
      spot.querySelector('.games-feedback').textContent = t('games.tryAgain')
      board?.set({ fen: decision.fen })
      return
    }
    board?.set({ fen: chess.fen(), movable: { color: undefined, dests: new Map() } })
    solvedMove = true
    spot.querySelector('.games-feedback').textContent = t('games.correct')
    try {
      await saveGameFact('drill', { ref: decision.ref, gameId: decision.gameId, result: 'solved', errors: attempts, aided, originAt: decision.originAt })
      game.recordDrill({ ref: decision.ref, errors: attempts, aided })
    } catch (error) { notify(t(error.message.startsWith('games.') ? error.message : 'games.saveError')) }
  }

  function nextDecision() {
    const list = decisions()
    const index = list.findIndex((d) => d.ref === selectedDecision?.ref)
    if (list.length) showDecision(list[(index + 1) % list.length])
  }

  const onVisibility = () => { if (!document.hidden) analyzePending() }
  document.addEventListener('visibilitychange', onVisibility)
  shell()
  return { destroy() { active = false; document.removeEventListener('visibilitychange', onVisibility); disposeBoard() } }
}
