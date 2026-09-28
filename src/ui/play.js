// Mode partie (spec section 6) : à la fin d'une ligne, ou depuis une position quelconque de
// l'explorateur, la partie continue en jeu libre contre Stockfish. Même plateau et même orientation
// que le drill de trainer.js (réutilise les classes .board-col/.drill-info, mises en page par la
// grille CSS .drill-host déjà en place) : mon camp joue tous les coups légaux, l'adversaire répond par
// engine.bestMove(fen, { elo }) (contrat 14.6), avec l'Elo des réglages. Fin de partie détectée : mat,
// pat, répétition, règle des 50 coups, matériel insuffisant. Promotion toujours en dame : aucun
// sélecteur de pièce dans cette V1, comme le reste de l'app (mountLineDrill et mountExplorer de
// trainer.js promeuvent aussi systématiquement en dame).
import { Chessground } from 'chessground'
import { Chess } from 'chess.js'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import * as sound from './sound.js'

function destsOf(chess) {
  const dests = new Map()
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, [])
    dests.get(m.from).push(m.to)
  }
  return dests
}
function lastMoveOf(chess) {
  const h = chess.history({ verbose: true }).at(-1)
  return h ? [h.from, h.to] : undefined
}
// "e7e8q" -> { from: 'e7', to: 'e8', promotion: 'q' } ; bestMove() (contrat 14.6) rend une chaîne UCI.
function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined }
}
// Fin de partie (section 6) : mat, pat, répétition, 50 coups, matériel insuffisant. `mate: true` sans
// message : mountPlay construit le message avec le camp joué (sideEn), que cette fonction ne connaît pas.
function outcomeOf(chess) {
  if (chess.isCheckmate()) return { over: true, mate: true }
  if (chess.isStalemate()) return { over: true, key: 'play.stalemate' }
  if (chess.isThreefoldRepetition()) return { over: true, key: 'play.repetition' }
  if (chess.isDrawByFiftyMoves()) return { over: true, key: 'play.fiftyMoves' }
  if (chess.isInsufficientMaterial()) return { over: true, key: 'play.insufficientMaterial' }
  return { over: false }
}

// mountPlay(host, { fen, sideEn, engine, elo, onOver, getSounds }) : monte le plateau et la feuille de
// partie dans host (attendu : le même conteneur .drill-host que mountLineDrill, pour hériter sa grille
// 2 colonnes). `engine` = contrat platform.engine du 14.6 (jamais null : l'appelant vérifie avant de
// monter). onOver() prévient l'appelant que la partie est terminée (désactive le bouton Abandonner).
// getSounds() (spec 15.4, chantier X2) : accessor du réglage `sounds`, lu à chaque coup plutôt que
// capturé une fois, pour suivre un changement de réglage en direct ; par défaut activé si omis.
// Rend { resign(), destroy() } ; "Revenir à l'entraînement" reste piloté par l'appelant (trainer.js),
// qui possède les boutons partagés avec le reste de l'écran.
export function mountPlay(host, { fen, sideEn, engine, elo, onOver, t, getSounds = () => true }) {
  host.innerHTML = `
    <section class="board-col">
      <div class="board-frame"><div class="cg-wrap board"></div></div>
      <div class="board-foot"><span class="eval" hidden>=</span><span class="line-name">${t('play.title')}</span></div>
    </section>
    <div class="drill-info">
      <div class="line-head"><h2 class="mono">${t('play.title')}</h2><span class="step"></span></div>
      <p class="feedback" data-tone="neutral">${t('play.loading')}</p>
      <ol class="sheet"></ol>
    </div>
  `
  const boardHost = host.querySelector('.board')
  const frame = host.querySelector('.board-frame')
  const stepEl = host.querySelector('.step')
  const feedbackEl = host.querySelector('.feedback')
  const sheetEl = host.querySelector('.sheet')

  const chess = new Chess(fen)
  const aborter = new AbortController()
  const st = {
    moves: [], // { san, color: 'w' | 'b' }, dans l'ordre joué depuis fen
    startNo: chess.moveNumber(),
    startColor: chess.turn(), // 'w' ou 'b' : le trait au moment de la reprise, pour numéroter la feuille
    over: false,
    busy: false,
    destroyed: false,
  }

  const cg = Chessground(boardHost, {
    fen: chess.fen(),
    orientation: sideEn,
    coordinates: true,
    animation: { enabled: true, duration: 220 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    drawable: { enabled: true, visible: true },
    movable: { free: false, color: sideEn, showDests: true, events: { after: onBoardMove } },
  })
  const ro = new ResizeObserver((entries) => {
    // Même garde que trainer.js : un panneau caché retombe à 0x0, ignorer ces passes évite des
    // coordonnées NaN côté chessground (le prochain redraw utile arrive au retour du panneau).
    const r = entries[0]?.contentRect
    if (r && r.width > 0 && r.height > 0) cg.redrawAll()
  })
  ro.observe(frame)

  function setFeedback(tone, text) {
    feedbackEl.dataset.tone = tone
    feedbackEl.textContent = text
  }
  function playMoveSound(mv) {
    const kind = chess.inCheck() ? 'check' : mv.captured ? 'capture' : 'move'
    sound.play(kind, { sounds: getSounds() })
  }
  function renderSheet() {
    sheetEl.innerHTML = ''
    let no = st.startNo
    let i = 0
    if (st.startColor === 'b' && st.moves.length) {
      // La reprise commence trait aux Noirs : la 1re demi-rangée n'a qu'une case noire.
      const li = document.createElement('li')
      const noCell = document.createElement('span')
      noCell.className = 'no'
      noCell.textContent = `${no}.`
      const empty = document.createElement('span')
      empty.className = 'mv'
      const black = document.createElement('span')
      black.className = 'mv'
      black.textContent = st.moves[0].san
      li.append(noCell, empty, black)
      sheetEl.append(li)
      no++
      i = 1
    }
    for (; i < st.moves.length; i += 2) {
      const li = document.createElement('li')
      const noCell = document.createElement('span')
      noCell.className = 'no'
      noCell.textContent = `${no}.`
      li.append(noCell)
      for (const j of [i, i + 1]) {
        const cell = document.createElement('span')
        cell.className = 'mv'
        if (st.moves[j]) cell.textContent = st.moves[j].san
        li.append(cell)
      }
      sheetEl.append(li)
      no++
    }
    sheetEl.scrollTop = sheetEl.scrollHeight
  }
  function syncBoard(interactive) {
    if (st.destroyed) return
    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      check: chess.inCheck(),
      lastMove: lastMoveOf(chess),
      movable: { color: interactive ? sideEn : undefined, dests: interactive ? destsOf(chess) : new Map() },
    })
  }
  function finishIfOver() {
    const res = outcomeOf(chess)
    if (!res.over) return false
    st.over = true
    syncBoard(false)
    let message
    let tone = 'neutral'
    if (res.mate) {
      // Le camp au trait est maté (isCheckmate) : l'autre camp gagne.
      const matedSide = chess.turn() === 'w' ? 'white' : 'black'
      const winner = matedSide === 'white' ? 'black' : 'white'
      const myWin = winner === sideEn
      message = t(myWin ? 'play.win' : 'play.lose')
      tone = myWin ? 'good' : 'bad'
      sound.play(myWin ? 'success' : 'error', { sounds: getSounds() })
    } else {
      message = t(res.key)
    }
    setFeedback(tone, message)
    stepEl.textContent = t('play.over')
    onOver?.()
    return true
  }
  async function engineReply() {
    st.busy = true
    syncBoard(false)
    setFeedback('neutral', t('play.thinking'))
    stepEl.textContent = t('play.stockfishTurn')
    // bestMove() (contrat 14.6) est censé rendre un coup légal ; un moteur mal branché, ou un moteur
    // factice de test bâclé, peut rendre null ou une chaîne UCI invalide. chess.move() lève alors une
    // exception (chess.js : jamais de retour vide sur un coup illégal) : on l'attrape pour finir la
    // partie proprement plutôt que de laisser planter la promesse.
    let mv
    try {
      const uci = await engine.bestMove(chess.fen(), { elo, signal: aborter.signal })
      if (!uci) throw new Error('aucun coup rendu par le moteur')
      mv = chess.move(uciToMove(uci))
    } catch (err) {
      if (st.destroyed || st.over) return
      console.error(err)
      st.over = true
      syncBoard(false)
      setFeedback('bad', t('play.engineError'))
      stepEl.textContent = t('play.over')
      onOver?.()
      return
    }
    if (st.destroyed || st.over) return
    playMoveSound(mv)
    st.moves.push({ san: mv.san, color: mv.color })
    renderSheet()
    if (finishIfOver()) return
    st.busy = false
    setFeedback('neutral', t('play.stockfishMove', { move: mv.san }))
    stepEl.textContent = t('play.yourTurn')
    syncBoard(true)
  }
  function onBoardMove(orig, dest) {
    if (st.busy || st.over) return
    let mv
    try {
      mv = chess.move({ from: orig, to: dest, promotion: 'q' })
    } catch {
      return syncBoard(true)
    }
    sound.unlock()
    playMoveSound(mv)
    st.moves.push({ san: mv.san, color: mv.color })
    renderSheet()
    if (finishIfOver()) return
    setFeedback('neutral', t('play.yourMove', { move: mv.san }))
    stepEl.textContent = t('play.stockfishTurn')
    engineReply()
  }
  function resign() {
    if (st.over) return
    st.over = true
    syncBoard(false)
    setFeedback('bad', t('play.resigned'))
    stepEl.textContent = t('play.over')
    onOver?.()
  }
  function destroy() {
    st.destroyed = true
    aborter.abort() // coup demandé mais pas encore joué : jeté par la file du moteur
    ro.disconnect()
    cg.destroy()
  }

  renderSheet()
  // La position de départ peut déjà être terminale (mat, pat...) : une ligne d'ouverture qui se
  // termine par un mat, ou n'importe quel nœud visité via l'explorateur. Vérifier avant de décider à
  // qui c'est le tour évite d'interroger le moteur sur une position sans coup légal.
  if (!finishIfOver()) {
    const myTurn = chess.turn() === (sideEn === 'white' ? 'w' : 'b')
    if (myTurn) {
      setFeedback('neutral', t('play.yourTurn'))
      stepEl.textContent = t('play.yourTurn')
      syncBoard(true)
    } else {
      engineReply()
    }
  }

  return { resign, destroy }
}
