// Écran d'entraînement : généralisation de l'entraîneur Alien Gambit à n'importe quelle ouverture et
// aux 2 camps. Exporte 2 briques réutilisées par src/ui/session.js (mountLineDrill, le plateau et la
// feuille de partie pour UNE ligne) et le point d'entrée d'écran `mount` (les 3 onglets historiques :
// S'entraîner, Explorer, Variantes) monté par src/main.js sur la route #/train/<id>[/<onglet>].
import { Chessground } from 'chessground'
import { Chess } from 'chess.js'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import { moveLabel, lineEnding } from '../core/lines.js'
import { statusOf, recordRun, pickNext as pickNextLine } from '../core/srs.js'
import {
  knownPrefixLength,
  phasesFor,
  showCardAt,
  countsErrors,
  markWeak,
  clearWeak,
  explainKeyFor,
} from '../core/learn.js'
import {
  resolveOpening,
  loadOpeningLines,
  isMyPly,
  formatEval,
  escapeHtml,
} from './shared.js'
import { selection, openings } from '../data.js'
import * as dataModule from '../data.js'
import { platform } from '../platform/index.js'
import { mountPlay } from './play.js'
import { mountHud } from './game.js'
import * as sound from './sound.js'
import { t as translate } from '../i18n.js'
import { eloToBand } from '../core/metrics.js'

// Chessground positions the dragged piece in its next animation frame. Follow the real
// touch or Pencil position immediately, then use Pencil prediction only for the visual
// position in that frame. Move validation continues to use real coordinates.
function followTouchDrag(cg) {
  let predictedFrame = 0
  let predictedDrag
  let predictedPosition

  function paintDrag(drag, x, y, real) {
    if (typeof drag.element === 'function') return
    if (real) drag.pos = [x, y]
    if (!drag.started) {
      const dx = x - drag.origPos[0]
      const dy = y - drag.origPos[1]
      if (dx * dx + dy * dy < cg.state.draggable.distance ** 2) return
      drag.started = true
    }
    const bounds = cg.state.dom.bounds()
    drag.element.style.transform = `translate(${x - bounds.left - bounds.width / 16}px,${y - bounds.top - bounds.height / 16}px)`
  }

  function onTouchMove(event) {
    const drag = cg.state.draggable.current
    if (!drag || event.touches.length !== 1) return
    const touch = event.touches[0]
    paintDrag(drag, touch.clientX, touch.clientY, true)
  }

  function onPointerMove(event) {
    if (event.pointerType !== 'pen') return
    const drag = cg.state.draggable.current
    if (!drag) return
    paintDrag(drag, event.clientX, event.clientY, true)
    const predicted = event.getPredictedEvents?.()
    if (!drag.started || !predicted?.length) return
    const next = predicted[predicted.length - 1]
    predictedDrag = drag
    predictedPosition = [next.clientX, next.clientY]
    if (predictedFrame) return
    predictedFrame = requestAnimationFrame(() => {
      predictedFrame = 0
      if (cg.state.draggable.current !== predictedDrag) return
      paintDrag(predictedDrag, ...predictedPosition, false)
    })
  }

  document.addEventListener('touchmove', onTouchMove, { passive: true })
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  return () => {
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('pointermove', onPointerMove)
    cancelAnimationFrame(predictedFrame)
  }
}

const french = (key, values) => translate('fr', key, values)

// getExplanations(id) : contrat 15.3 (src/data.js expose getExplanations(id), écrit par un autre
// agent en parallèle sur ce même chantier). Repli tant que cet export n'existe pas encore : lit
// directement le store (`explain:<id>`, écrit par src/ui/generate.js juste après une génération dans
// l'app) ; le fichier livré avec le catalogue (`catalog/explain/<id>.json`) ne redevient accessible
// que via data.js, une fois l'export réel en place. Vérifié dynamiquement à CHAQUE appel (pas mis en
// cache) : dès que data.js expose getExplanations, ce repli s'efface tout seul, sans changement de
// code ici. ÉCART SIGNALÉ (voir le rapport de ce chantier) : ce repli ne lit jamais
// catalog/explain/<id>.json, seulement le store.
export async function getExplanations(id) {
  if (typeof dataModule.getExplanations === 'function') return dataModule.getExplanations(id)
  try {
    return (await platform.store.get(`explain:${id}`)) || null
  } catch {
    return null
  }
}

// Mode partie (spec section 6, contrat 14.6) : le bouton "Continuer contre Stockfish" n'apparaît que
// si un moteur existe. platform.engine est null en web, jamais en Tauri (createEngine() y est
// inconditionnel) ; un smoke test web peut malgré tout prouver tout le déroulé du mode partie en
// posant un moteur factice via window.__theorieSetEngine(engine). Ce crochet ne s'active jamais de
// lui-même : sans appel explicite, engineFor() reste null et le bouton reste caché en web.
function engineFor() {
  return platform.engine || window.__theorieTestEngine || null
}
if (!window.__theorieSetEngine) {
  window.__theorieSetEngine = (engine) => { window.__theorieTestEngine = engine }
}

// verdictText(ending) : texte du verdict de fin de ligne (lineEnding, src/core/lines.js). « Échec et
// mat » seulement sur un mat réel ; un mat forcé non joué s'annonce « Mat en N » (spec V2, L0 point 2).
export function verdictText(ending, t = french) {
  if (ending.kind === 'checkmate') return t('train.checkmate')
  if (ending.kind === 'mate') return t(ending.forMe ? 'train.mateFor' : 'train.mateAgainst', { count: ending.mateIn })
  if (ending.winning) return t('train.winning', { eval: formatEval(ending.eval) })
  return t('train.theoryEnd', { eval: formatEval(ending.eval) ?? '=' })
}

// ---------- drill : plateau + feuille de partie, pour UNE ligne ----------
// mountLineDrill(host, { sideEn, onFinish, getSounds }) construit le plateau une seule fois ;
// setLine() change de ligne sans recréer chessground. onFinish(errors, { weak }) est appelé quand
// TOUTES les phases demandées sont jouées jusqu'au bout : l'appelant décide de la suite (srs.recordRun
// avec ces `errors` et ce `weak`, ligne suivante, session).
//
// Jeu (spec V2 L10) : onMoveResult(ok) suit chaque coup de mon camp d'un passage qui compte (Rappeler,
// Réviser, ou drill sans `learn`) : ok au 1er essai, ou la 1re faute ou le 1er indice sur ce coup.
// onFinish reçoit aussi `own` (coups de mon camp dans la ligne) et `ms` (durée du dernier passage).
//
// Cycle Découvrir/Rappeler/Réviser (spec 15.1, chantier X2) : setLine(line, { learn }) accepte un
// 2e argument optionnel `learn = { phases, knownPrefix, weak, explain }` (voir learnFor() plus bas
// dans ce fichier, et src/core/learn.js pour les briques pures). `phases` est une file de passages à
// jouer À LA SUITE sur la MÊME ligne (['discover','recall'] pour une ligne neuve, ['review'] pour une
// ligne due ou ratée) : le passage de Découvrir à Rappeler est géré ICI, en interne (finishPhase), et
// seul le TOUT DERNIER passage appelle onFinish (spec 15.1 : "seul ce passage compte pour les
// révisions espacées"). Sans `learn` (2e argument omis), le drill se comporte EXACTEMENT comme avant
// ce chantier : aucune fiche, aucune restriction de phase, errors toujours compté.
export function mountLineDrill(host, { sideEn, onFinish, onMoveResult = () => {}, getSounds = () => true, t = french, locale = 'fr', guided = true }) {
  host.innerHTML = `
    <section class="board-col">
      <div class="board-frame"><div class="cg-wrap board"></div></div>
      <div class="board-foot">
        <span class="eval" title="${t('train.evalTitle')}">=</span>
        <span class="line-name"></span>
      </div>
    </section>
    <div class="drill-info">
      <div class="hud-slot"></div>
      <div class="line-head">
        <div class="line-head-title"><h2 class="mono"></h2><span class="phase-badge" hidden></span></div>
        <span class="step"></span>
      </div>
      <div class="explain-card" hidden>
        <p class="explain-idea"></p>
        <ul class="explain-details" hidden></ul>
        <p class="explain-eval mono" hidden></p>
        <p class="explain-human" hidden></p>
        <button type="button" class="explain-continue" hidden>${t('continue')} <kbd>${t('train.space')}</kbd></button>
      </div>
      <p class="feedback" data-tone="neutral">${t('train.loading')}</p>
      <ol class="sheet"></ol>
    </div>
  `
  const boardHost = host.querySelector('.board')
  const frame = host.querySelector('.board-frame')
  const evalEl = host.querySelector('.eval')
  const lineNameEl = host.querySelector('.line-name')
  const titleEl = host.querySelector('.line-head h2')
  const phaseBadgeEl = host.querySelector('.phase-badge')
  const stepEl = host.querySelector('.step')
  const feedbackEl = host.querySelector('.feedback')
  const sheetEl = host.querySelector('.sheet')
  const cardEl = host.querySelector('.explain-card')
  const cardIdeaEl = host.querySelector('.explain-idea')
  const cardDetailsEl = host.querySelector('.explain-details')
  const cardEvalEl = host.querySelector('.explain-eval')
  const cardHumanEl = host.querySelector('.explain-human')
  const cardContinueBtn = host.querySelector('.explain-continue')

  const st = {
    line: null, chess: null, ply: 0, errors: 0, tries: 0, hint: 0, busy: false, side: sideEn,
    learn: null,        // { phases (déjà consommé -> voir st.phases), knownPrefix, weak, explain } | null
    phases: [],          // file des passages restants pour CETTE ligne (setLine), interne
    phase: null,          // passage courant : 'discover' | 'recall' | 'review' | null (mode classique)
    weak: [],             // copie de travail du champ weak (spec 15.1), mise à jour à la fin de chaque passage
    errorPlies: new Set(), // demi-coups fautifs du passage COURANT (recall/review), pour recalculer weak
    advanceTimer: null,    // pause "carte adversaire" en cours (Découvrir), voir scheduleAdvance/doAdvance
    pendingFinish: false,  // la pause en cours doit finir la phase (dernier coup adverse avec fiche), pas rendre la main
    aided: false,          // une fiche a été montrée avant une de mes tentatives du passage courant (Réviser)
    startedAt: 0,          // début du passage courant (durée transmise à onFinish, jeu)
  }
  // Toutes les temporisations du drill (réponse adverse, pause de fiche, flèche après erreur) passent
  // par later() : setLine(), le passage de Découvrir à Rappeler et destroy() les annulent toutes, pour
  // qu'aucune réponse programmée pour l'ancienne ligne ne se joue sur la nouvelle (spec V2, L0 point 3).
  const timers = new Set()
  function later(fn, ms) {
    const id = setTimeout(() => { timers.delete(id); fn() }, ms)
    timers.add(id)
    return id
  }
  function clearTimers() {
    for (const id of timers) clearTimeout(id)
    timers.clear()
    st.advanceTimer = null
  }

  const cg = Chessground(boardHost, {
    orientation: sideEn,
    coordinates: true,
    animation: { enabled: true, duration: 100 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    drawable: { enabled: true, visible: true },
    movable: { free: false, color: sideEn, showDests: true, events: { after: onBoardMove } },
  })
  const stopTouchDrag = followTouchDrag(cg)
  const ro = new ResizeObserver((entries) => {
    // Un panneau caché retombe à 0x0 : redessiner alors (des flèches actives incluses) produit des
    // coordonnées NaN cote chessground. On ignore ces passes, le prochain redraw utile arrivera
    // quand le panneau redevient visible (explorer.redraw() / drill.redraw() dans switchTab).
    const r = entries[0]?.contentRect
    if (r && r.width > 0 && r.height > 0) cg.redrawAll()
  })
  ro.observe(frame)

  // Pause "carte adversaire" (Découvrir, spec 15.1 "rythme confortable, bouton ou touche Espace pour
  // avancer si utile") : après un coup adverse expliqué, le bouton Continuer apparaît et la touche
  // Espace fait pareil, en plus de l'avance automatique après un délai. Écouteur posé sur `document`
  // (et retiré dans destroy()) : Espace n'est pas un raccourci du menu natif (contrat 14.6), donc rien
  // ne l'intercepte ailleurs.
  function onSpace(e) {
    if (e.key !== ' ' && e.code !== 'Space') return
    if (cardContinueBtn.hidden) return
    const tag = e.target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    e.preventDefault()
    sound.unlock()
    doAdvance()
  }
  document.addEventListener('keydown', onSpace)
  cardContinueBtn.addEventListener('click', () => { sound.unlock(); doAdvance() })

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
  function syncBoard({ movableColor, shapes = [] } = {}) {
    const { chess } = st
    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      check: chess.inCheck(),
      lastMove: lastMoveOf(chess),
      movable: { color: movableColor ?? undefined, dests: movableColor ? destsOf(chess) : new Map() },
    })
    cg.setAutoShapes(shapes)
  }
  function flash(kind) {
    frame.classList.remove('flash-bad', 'flash-good')
    void frame.offsetWidth
    frame.classList.add(`flash-${kind}`)
  }
  function setFeedback(tone, text) {
    feedbackEl.dataset.tone = tone
    feedbackEl.textContent = text
  }
  function showEval(ply) {
    const { line } = st
    let e = null
    for (let i = ply - 1; i >= 0 && e == null; i--) e = line.evals[i]
    evalEl.textContent = formatEval(e) ?? '='
    evalEl.dataset.side = e == null ? '' : e >= 0 ? 'white' : 'black'
  }
  function renderSheet() {
    const { line, ply } = st
    const pending = isMyPly(ply, st.side) && ply < line.moves.length
    sheetEl.innerHTML = ''
    for (let i = 0; i < Math.max(ply, pending ? ply + 1 : 0); i += 2) {
      const li = document.createElement('li')
      const no = document.createElement('span')
      no.className = 'no'
      no.textContent = `${i / 2 + 1}.`
      li.append(no)
      for (const j of [i, i + 1]) {
        const cell = document.createElement('span')
        cell.className = 'mv'
        if (j < ply) cell.textContent = line.moves[j]
        else if (pending && j === ply) { cell.textContent = '?'; cell.classList.add('pending') }
        if (j === ply - 1) cell.classList.add('current')
        li.append(cell)
      }
      sheetEl.append(li)
    }
    sheetEl.scrollTop = sheetEl.scrollHeight
  }
  function render() {
    const { line, ply } = st
    titleEl.textContent = line.name
    lineNameEl.textContent = line.group
    stepEl.textContent = t('train.step', { current: Math.min(Math.floor(ply / 2) + 1, Math.ceil(line.moves.length / 2)), total: Math.ceil(line.moves.length / 2) })
    renderSheet()
    const mine = isMyPly(ply, st.side) && ply < line.moves.length
    syncBoard({ movableColor: mine && !st.busy ? st.side : null })
    showEval(ply)
  }
  function expectedMove() {
    const c = new Chess(st.chess.fen())
    return c.move(st.line.moves[st.ply])
  }

  // ---- fiche d'explication (spec 15.1/15.2, chantier X2) ----
  // cardFor(moves, ply) : le nœud d'explication pour ce demi-coup, ou un texte de repli si aucune
  // explication n'a encore été calculée pour l'ouverture (spec 15.1, dernier paragraphe) ou pour ce
  // coup précis (données partielles).
  function cardFor(moves, ply) {
    const explain = st.learn?.explain
    if (!explain) return { idea: t('train.noExplanation'), details: [], eval: null, human: null }
    const node = explain.nodes?.[explainKeyFor(moves, ply)]
    if (!node) return { idea: t('train.noMoveExplanation'), details: [], eval: null, human: null }
    if (locale === 'fr') return node
    const chess = new Chess()
    let move = null
    for (const san of moves.slice(0, ply + 1)) move = chess.move(san)
    const piece = node.facts?.pieceType || move?.piece
    const square = node.facts?.to || move?.to
    const knownTags = ['capture', 'check', 'mate', 'castle', 'sacrifice', 'fork', 'development', 'center', 'best-defense', 'mistake', 'frequent', 'threat']
    const details = (node.tags || []).filter((value) => knownTags.includes(value)).slice(0, 3).map((value) => t(`explain.tag.${value}`))
    if (node.facts?.freq != null && node.facts?.games != null) details.push(t('explain.frequency', { percent: Math.round(node.facts.freq * 100), games: node.facts.games }))
    return {
      idea: piece && square ? t('explain.pieceMove', { piece: t(`piece.${piece}`), square }) : t('train.moveExplanation', { move: moves[ply] }),
      details, eval: null, human: null,
    }
  }
  function showCard(node, kind) {
    cardEl.hidden = false
    cardEl.dataset.kind = kind
    cardIdeaEl.textContent = node.idea || ''
    const details = node.details || []
    cardDetailsEl.replaceChildren(...details.map((detail) => {
      const li = document.createElement('li')
      li.textContent = detail
      return li
    }))
    cardDetailsEl.hidden = details.length === 0
    cardEvalEl.textContent = node.eval || ''
    cardEvalEl.hidden = !node.eval
    cardHumanEl.textContent = node.human || ''
    cardHumanEl.hidden = !node.human
  }
  function hideCard() {
    cardEl.hidden = true
    cardContinueBtn.hidden = true
  }
  function updatePhaseBadge() {
    if (!st.learn) { phaseBadgeEl.hidden = true; return }
    phaseBadgeEl.hidden = false
    phaseBadgeEl.textContent = st.phase ? t(`phase.${st.phase}`) : ''
    phaseBadgeEl.dataset.phase = st.phase || ''
  }
  function cardActiveAt(ply, opts = {}) {
    return !!st.learn && showCardAt(st.phase, ply, st.side, { knownPrefix: st.learn.knownPrefix, weak: st.weak, ...opts })
  }
  // maybeShowMyCard() : à appeler chaque fois que c'est (ou redevient) mon tour. Découvrir sur un
  // coup au delà du préfixe connu : fiche + flèche verte complète (orig+dest), le coup est donné.
  // Réviser sur un coup faible : fiche seule, sans flèche (rappel guidé, pas donné). Sinon : rien.
  function maybeShowMyCard() {
    const { line, ply, side } = st
    if (ply >= line.moves.length || !isMyPly(ply, side) || !cardActiveAt(ply)) {
      hideCard()
      cg.setAutoShapes([])
      return
    }
    showCard(cardFor(line.moves, ply), 'own')
    if (st.phase === 'review') st.aided = true
    if (st.phase === 'discover' && guided) {
      const exp = expectedMove()
      cg.setAutoShapes([{ orig: exp.from, dest: exp.to, brush: 'green' }])
    }
  }
  function playMoveSound(mv) {
    const kind = st.chess.inCheck() ? 'check' : mv.captured ? 'capture' : 'move'
    sound.play(kind, { sounds: getSounds() })
  }
  // doAdvance()/scheduleAdvance() : la pause "carte adversaire" de Découvrir (voir onSpace plus haut).
  function doAdvance() {
    if (st.advanceTimer) { clearTimeout(st.advanceTimer); timers.delete(st.advanceTimer); st.advanceTimer = null }
    if (cardContinueBtn.hidden) return // rien en attente : appel redondant (Espace, double-clic), sans effet
    cardContinueBtn.hidden = true
    if (st.pendingFinish) { // fiche du dernier coup adverse de la ligne acquittée : finir maintenant
      st.pendingFinish = false
      st.busy = false
      return finish()
    }
    st.busy = false
    setFeedback('neutral', t('train.yourTurn'))
    render()
    maybeShowMyCard()
  }
  function scheduleAdvance(ms) {
    cardContinueBtn.hidden = false
    st.advanceTimer = later(doAdvance, ms)
  }

  function defaultStartMessage() {
    if (!isMyPly(0, st.side)) return t('train.watchOpponent')
    if (!st.learn) return t('train.firstMove')
    if (st.phase === 'discover') return t(guided ? 'train.discoverPrompt' : 'train.discoverCompact')
    if (st.phase === 'review') return t('train.reviewPrompt')
    return t('train.recallPrompt')
  }
  // beginPhase() : (re)démarre le passage COURANT (st.phase) depuis le début de la ligne : utilisé par
  // setLine() (1er passage) et par finishPhase() (enchaînement Découvrir -> Rappeler, même ligne).
  function beginPhase(message) {
    st.startedAt = Date.now()
    hideCard()
    updatePhaseBadge()
    setFeedback('neutral', message ?? defaultStartMessage())
    render()
    if (isMyPly(0, st.side)) maybeShowMyCard()
    else { st.busy = true; later(autoOpponentMove, st.phase === 'discover' ? 450 : 180) }
  }

  function autoOpponentMove() {
    const { line, chess, side } = st
    const ply = st.ply
    const mv = chess.move(line.moves[ply])
    playMoveSound(mv)
    st.ply++
    const showsCard = !!st.learn && showCardAt(st.phase, ply, side, { knownPrefix: st.learn.knownPrefix, weak: st.weak })
    if (st.ply >= line.moves.length) {
      // Dernier coup de la ligne joué par l'adversaire, avec fiche (fréquent aux Noirs, ou tout mat
      // adverse) : ne pas finir tout de suite (finish() recacherait la fiche dans le même tick, avant
      // tout repaint, spec 15.1 "les coups adverses sont joués par l'app avec leur fiche") - la montrer
      // et attendre l'acquittement (bouton Continuer / Espace / délai), comme un coup adverse
      // intermédiaire, puis seulement finir (doAdvance -> finish()).
      if (showsCard) {
        showCard(cardFor(line.moves, ply), 'opp')
        setFeedback('neutral', t('train.opponentMove', { move: moveLabel(ply, mv.san) }))
        render()
        st.pendingFinish = true
        scheduleAdvance(1500)
        return
      }
      st.busy = false
      hideCard()
      return finish()
    }
    if (showsCard) {
      showCard(cardFor(line.moves, ply), 'opp')
      setFeedback('neutral', t('train.opponentMove', { move: moveLabel(ply, mv.san) }))
      render()
      scheduleAdvance(1500)
      return
    }
    hideCard()
    st.busy = false
    setFeedback('neutral', t('train.opponentThenYou', { move: moveLabel(ply, mv.san) }))
    render()
    maybeShowMyCard()
  }
  function finish() {
    render()
    hideCard()
    finishPhase()
  }
  // finishPhase() : fin du passage courant. Découvrir enchaîne directement sur Rappeler, MÊME ligne,
  // sans repasser par l'appelant (spec 15.1) ; recalcule `weak` seulement pour un passage qui compte
  // (Rappeler, Réviser : jamais Découvrir, qui ne compte aucune faute) - un coup faible rejoué sans
  // faute redevient normal, un coup fauté (faible ou non) le devient (ou le reste).
  function finishPhase() {
    const finishedPhase = st.phase
    if (st.learn && finishedPhase !== 'discover') {
      let w = st.weak
      for (const ply of st.weak) if (!st.errorPlies.has(ply)) w = clearWeak(w, ply)
      for (const ply of st.errorPlies) w = markWeak(w, ply)
      st.weak = w
    }
    st.phases.shift()
    if (st.phases.length) {
      clearTimers()
      Object.assign(st, { chess: new Chess(), ply: 0, tries: 0, hint: 0, busy: false, phase: st.phases[0], errorPlies: new Set(), pendingFinish: false, aided: false })
      beginPhase(t('train.recallSameLine'))
      return
    }
    if (st.errors === 0) sound.play('perfect', { sounds: getSounds() })
    const own = st.line.moves.filter((_, ply) => isMyPly(ply, st.side)).length
    onFinish(st.errors, { weak: st.learn ? st.weak : undefined, aided: st.aided, checkmate: st.chess.isCheckmate(), own, ms: Date.now() - st.startedAt })
  }
  function onBoardMove(orig, dest) {
    const { line, chess } = st
    if (!line || st.busy) return
    sound.unlock()
    let mv
    try { mv = chess.move({ from: orig, to: dest, promotion: 'q' }) } catch { return render() }
    const expected = line.moves[st.ply]
    const ply = st.ply
    if (mv.san === expected) {
      playMoveSound(mv)
      if (countsErrors(st.phase) && !st.errorPlies.has(ply) && st.hint === 0) onMoveResult(true, { ply })
      st.ply++
      st.tries = 0
      st.hint = 0
      flash('good')
      hideCard()
      if (st.ply >= line.moves.length) return finish()
      setFeedback('good', t('train.correctMove', { move: moveLabel(ply, mv.san) }))
      st.busy = true
      render()
      later(autoOpponentMove, 220)
      return
    }
    chess.undo()
    const exp = expectedMove()
    if (line.alts[st.ply]?.includes(mv.san)) {
      setFeedback('warn', t('train.alternative', { played: mv.san, expected: exp.san }))
      render()
      cg.setAutoShapes([{ orig: exp.from, dest: exp.to, brush: 'paleGreen' }])
      return
    }
    sound.play('error', { sounds: getSounds() })
    // Rappeler (spec 15.1) : aucune fiche avant le coup, mais une erreur en montre une, réactivement
    // (justErred) - Réviser l'a déjà affichée par avance (weak), cet appel la republie sans effet.
    const cardActive = cardActiveAt(ply, { justErred: true })
    if (cardActive) showCard(cardFor(line.moves, ply), 'own')
    if (countsErrors(st.phase)) {
      if (!st.errorPlies.has(ply)) onMoveResult(false, { ply })
      st.errors++
      st.errorPlies.add(ply)
    }
    st.tries++
    flash('bad')
    later(() => {
      render()
      if (cardActive || st.tries >= 2) cg.setAutoShapes([{ orig: exp.from, dest: exp.to, brush: 'green' }])
    }, 250)
    setFeedback('bad', cardActive
      ? t('train.wrongWithCard', { played: mv.san, expected: exp.san })
      : st.tries >= 2
        ? t('train.wrongWithArrow', { played: mv.san, expected: exp.san })
        : t('train.wrongRetry', { played: mv.san }))
  }
  // setLine(line, { message, learn }) : `learn` (voir learnFor() plus bas dans ce fichier) déclenche
  // le cycle Découvrir/Rappeler/Réviser ; omis, le drill reste le comportement d'avant ce chantier.
  function setLine(line, { message, learn = null } = {}) {
    const phases = learn ? [...learn.phases] : [null]
    clearTimers()
    Object.assign(st, {
      line, chess: new Chess(), ply: 0, errors: 0, tries: 0, hint: 0, busy: false,
      learn, phases, phase: phases[0], errorPlies: new Set(), weak: learn ? [...(learn.weak || [])] : [],
      pendingFinish: false, aided: false,
    })
    beginPhase(message)
  }
  function hint() {
    const { line, ply } = st
    if (!line || !isMyPly(ply, st.side) || ply >= line.moves.length || st.busy) return
    const exp = expectedMove()
    st.hint++
    if (st.hint === 1 && countsErrors(st.phase)) {
      if (!st.errorPlies.has(ply)) onMoveResult(false, { ply })
      st.errors++
      st.errorPlies.add(ply)
    }
    cg.setAutoShapes(st.hint === 1 ? [{ orig: exp.from, brush: 'green' }] : [{ orig: exp.from, dest: exp.to, brush: 'green' }])
    setFeedback('warn', st.hint === 1 ? t('train.hintPiece') : t('train.hintMove', { move: exp.san }))
  }
  // restart() : rejoue le passage COURANT (st.phase) seul, pas tout le cycle depuis Découvrir - un
  // clic sur "Rejouer la ligne" en Rappeler ou Réviser rejoue ce même passage, pas la leçon entière.
  function restart() {
    if (!st.line) return
    const learn = st.learn ? { ...st.learn, phases: [st.phase] } : null
    setLine(st.line, { message: t('train.restarted'), learn })
  }
  function destroy() {
    ro.disconnect()
    stopTouchDrag()
    cg.destroy()
    document.removeEventListener('keydown', onSpace)
    clearTimers()
  }
  return { setLine, hint, restart, destroy, setFeedback, redraw: () => cg.redrawAll(), getFen: () => st.chess.fen(), host }
}

// ---------- explorateur : parcourt librement l'arbre, propose de cibler une branche ----------
// onPlay(fen) : "Continuer contre Stockfish" depuis la position explorée (n'importe quel nœud de
// l'arbre, section 6). Le bouton est câblé même sans moteur ; sa visibilité, décidée par l'appelant
// (trainer.js, via setPlayVisible), suit platform.engine à chaque ouverture de l'onglet Explorer.
function mountExplorer(host, { tree, sideEn, onDrill, onPlay, t = french }) {
  host.innerHTML = `
    <section class="board-col">
      <div class="board-frame"><div class="cg-wrap board"></div></div>
      <div class="board-foot"><span class="eval">=</span><span class="line-name"></span></div>
    </section>
    <div class="drill-info">
      <p class="feedback" data-tone="neutral"></p>
      <div class="choices"></div>
      <ol class="sheet"></ol>
      <div class="actions">
        <button type="button" class="x-start">${t('train.start')}</button>
        <button type="button" class="x-back">${t('train.back')}</button>
        <button type="button" class="x-play" hidden>${t('train.playStockfish')}</button>
        <button type="button" class="x-drill primary">${t('train.drillBranch')}</button>
      </div>
    </div>
  `
  const infoEl = host.querySelector('.feedback')
  const choicesEl = host.querySelector('.choices')
  const sheetEl = host.querySelector('.sheet')
  const drillBtn = host.querySelector('.x-drill')
  const playBtn = host.querySelector('.x-play')
  const frame = host.querySelector('.board-frame')
  const evalEl = host.querySelector('.eval')
  const lineNameEl = host.querySelector('.line-name')
  let path = []
  let badMoveTimer = null

  function nodesAt(p) {
    let nodes = tree
    for (const san of p) nodes = nodes.find((n) => n.m === san)?.c || []
    return nodes
  }
  function fenAt(p) {
    const chess = new Chess()
    for (const san of p) chess.move(san)
    return chess.fen()
  }
  function countUnder(p) {
    let total = 0
    ;(function walk(nodes) {
      for (const n of nodes) { if (n.c?.length) walk(n.c); else total++ }
    })(nodesAt(p))
    return total
  }
  function lastMoveOf(chess) {
    const h = chess.history({ verbose: true }).at(-1)
    return h ? [h.from, h.to] : undefined
  }
  function render() {
    const chess = new Chess()
    const evals = []
    let nodes = tree
    for (const san of path) {
      const n = nodes.find((x) => x.m === san)
      chess.move(san)
      evals.push(n.e ?? null)
      nodes = n.c || []
    }
    const shapes = nodes.map((n) => {
      const mine = isMyPly(path.length, sideEn)
      const m = new Chess(chess.fen()).move(n.m)
      return { orig: m.from, dest: m.to, brush: mine ? 'green' : 'blue' }
    })
    cg.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      check: chess.inCheck(),
      lastMove: lastMoveOf(chess),
      movable: { color: nodes.length ? (chess.turn() === 'w' ? 'white' : 'black') : undefined, dests: nodes.length ? destsOf(chess) : new Map() },
    })
    cg.setAutoShapes(shapes)
    let e = null
    for (let i = evals.length - 1; i >= 0 && e == null; i--) e = evals[i]
    evalEl.textContent = formatEval(e) ?? '='
    evalEl.dataset.side = e == null ? '' : e >= 0 ? 'white' : 'black'
    renderSheet(chess, evals)

    choicesEl.innerHTML = ''
    for (const n of nodes) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'choice'
      const count = countUnder([...path, n.m])
      b.innerHTML = `<span class="mono">${moveLabel(path.length, n.m)}</span><small>${t('train.lineCount', { count })}</small>`
      b.addEventListener('click', () => { path.push(n.m); render() })
      choicesEl.append(b)
    }
    const who = t(chess.turn() === 'w' ? 'train.whiteToMove' : 'train.blackToMove')
    infoEl.dataset.tone = 'neutral'
    const under = countUnder(path)
    infoEl.textContent = nodes.length ? t('train.branchInfo', { who, count: under }) : t('train.branchEnd')
    lineNameEl.textContent = path.length ? t('train.movesPlayed', { count: path.length }) : t('train.startPosition')
    drillBtn.disabled = path.length === 0
  }
  function renderSheet(chess, evals) {
    sheetEl.innerHTML = ''
    void evals
    for (let i = 0; i < path.length; i += 2) {
      const li = document.createElement('li')
      const no = document.createElement('span')
      no.className = 'no'
      no.textContent = `${i / 2 + 1}.`
      li.append(no)
      for (const j of [i, i + 1]) {
        const cell = document.createElement('button')
        cell.type = 'button'
        cell.className = 'mv'
        if (j < path.length) { cell.textContent = path[j]; cell.addEventListener('click', () => { path = path.slice(0, j + 1); render() }) }
        if (j === path.length - 1) cell.classList.add('current')
        li.append(cell)
      }
      sheetEl.append(li)
    }
    sheetEl.scrollTop = sheetEl.scrollHeight
  }
  function destsOf(chess) {
    const dests = new Map()
    for (const m of chess.moves({ verbose: true })) {
      if (!dests.has(m.from)) dests.set(m.from, [])
      dests.get(m.from).push(m.to)
    }
    return dests
  }
  function onMove(orig, dest) {
    const chess = new Chess()
    path.forEach((s) => chess.move(s))
    let mv
    try { mv = chess.move({ from: orig, to: dest, promotion: 'q' }) } catch { return render() }
    if (nodesAt(path).some((n) => n.m === mv.san)) path.push(mv.san)
    else {
      infoEl.dataset.tone = 'bad'
      infoEl.textContent = t('train.outsideTree', { move: mv.san })
      clearTimeout(badMoveTimer)
      badMoveTimer = setTimeout(render, 900)
      return
    }
    render()
  }

  // Un board dédié à l'explorateur : la conversion "board de drill" ne s'applique pas ici (pas de
  // ligne unique, choix multiples possibles à chaque position).
  const cg = Chessground(host.querySelector('.board'), {
    orientation: sideEn,
    coordinates: true,
    animation: { enabled: true, duration: 100 },
    highlight: { lastMove: true, check: true },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    drawable: { enabled: true, visible: true },
    movable: { free: false, showDests: true, events: { after: onMove } },
  })
  const ro = new ResizeObserver((entries) => {
    // Un panneau caché retombe à 0x0 : redessiner alors (des flèches actives incluses) produit des
    // coordonnées NaN cote chessground. On ignore ces passes, le prochain redraw utile arrivera
    // quand le panneau redevient visible (explorer.redraw() / drill.redraw() dans switchTab).
    const r = entries[0]?.contentRect
    if (r && r.width > 0 && r.height > 0) cg.redrawAll()
  })
  ro.observe(frame)

  host.querySelector('.x-start').addEventListener('click', () => { path = []; render() })
  host.querySelector('.x-back').addEventListener('click', () => { path.pop(); render() })
  drillBtn.addEventListener('click', () => onDrill([...path]))
  playBtn.addEventListener('click', () => onPlay?.(fenAt(path)))
  render()

  return {
    back() { path.pop(); render() },
    forward() { const n = nodesAt(path)[0]; if (n) { path.push(n.m); render() } },
    setPlayVisible(v) { playBtn.hidden = !v },
    destroy() { clearTimeout(badMoveTimer); ro.disconnect(); cg.destroy() },
    redraw: () => cg.redrawAll(),
  }
}

function linesUnder(lines, path) {
  const id = path.join(' ')
  if (!id) return lines
  return lines.filter((l) => l.id === id || l.id.startsWith(id + ' '))
}

// ---------- écran : les 3 onglets pour une ouverture ----------
export async function mount(host, ctx) {
  const { params, state, saveProgress, setActions, game, t } = ctx
  const opening = resolveOpening(params.id, { selection, openings })
  if (!opening) {
    host.innerHTML = `<p class="empty">${t('opening.missing')} <a href="#/library">${t('opening.back')}</a>.</p>`
    setActions({})
    return { destroy() {} }
  }
  const sideEn = opening.side
  const openingName = state.settings.locale === 'fr' ? opening.name : opening.lichessName || opening.name
  host.innerHTML = `
    <header class="train-top">
      <div class="train-heading">
        <p class="eyebrow">${t(`side.${opening.side}`)} · <a href="#/opening/${opening.id}">${escapeHtml(openingName)}</a></p>
      </div>
      <div class="train-progress" aria-live="polite">
        <p class="counts">
          <span><b class="cnt-mastered">0</b> ${t('train.countMastered')}</span>
          <span><b class="cnt-learning">0</b> ${t('train.countLearning')}</span>
          <span><b class="cnt-review">0</b> ${t('train.countReview')}</span>
          <span><b class="cnt-new">0</b> ${t('train.countNew')}</span>
        </p>
        <div class="bar" aria-hidden="true">
          <span class="seg mastered"></span>
          <span class="seg learning"></span>
          <span class="seg review"></span>
        </div>
      </div>
    </header>
    <main class="stage">
      <div class="tabs" role="tablist" aria-label="${t('train.modes')}">
        <button type="button" role="tab" data-tab="train" aria-selected="true">${t('train.tabDrill')}</button>
        <button type="button" role="tab" data-tab="explore" aria-selected="false">${t('train.tabExplore')}</button>
        <button type="button" role="tab" data-tab="lines" aria-selected="false">${t('train.tabLines')} <span class="lines-count"></span></button>
      </div>
      <section class="pane" data-pane="train">
        <div class="scope" hidden><span>${t('train.branchTarget')} <b class="scope-name mono"></b></span><button type="button" class="scope-clear link">${t('train.fullOpening')}</button></div>
        <div class="drill-host"></div>
        <div class="actions">
          <button type="button" class="btn-hint">${t('session.hint')}</button>
          <button type="button" class="btn-restart">${t('session.replay')}</button>
          <button type="button" class="btn-next primary">${t('train.nextLine')}</button>
          <button type="button" class="btn-continue-stockfish" hidden>${t('train.playStockfish')}</button>
          <button type="button" class="btn-resign" hidden>${t('train.resign')}</button>
          <button type="button" class="btn-exit-play primary" hidden>${t('train.backToDrill')}</button>
        </div>
      </section>
      <section class="pane" data-pane="explore" hidden></section>
      <section class="pane" data-pane="lines" hidden>
        <p class="variation-help">${t('train.variationHelp')}</p>
        <div class="line-groups"></div>
      </section>
    </main>
  `
  const countsEl = host.querySelector('.train-progress')
  const linesCountEl = host.querySelector('.lines-count')
  const scopeEl = host.querySelector('.scope')
  const scopeNameEl = host.querySelector('.scope-name')
  const drillHost = host.querySelector('.drill-host')
  const explorePane = host.querySelector('[data-pane="explore"]')
  const linesPane = host.querySelector('.line-groups')
  const hintBtn = host.querySelector('.btn-hint')
  const restartBtn = host.querySelector('.btn-restart')
  const nextBtn = host.querySelector('.btn-next')
  const continueBtn = host.querySelector('.btn-continue-stockfish')
  const resignBtn = host.querySelector('.btn-resign')
  const exitPlayBtn = host.querySelector('.btn-exit-play')

  const [{ tree, lines, unavailable }, explainData] = await Promise.all([loadOpeningLines(opening), getExplanations(opening.id)])
  if (!lines.length) {
    drillHost.innerHTML = unavailable
      ? `<p class="empty">${t('train.offlineMissing')}</p>`
      : `<p class="empty">${t('train.treeMissing')} <a href="#/opening/${opening.id}">${t('opening.back')}</a>.</p>`
    host.querySelectorAll('.tabs button, .actions button').forEach((b) => { b.disabled = true })
    setActions({})
    return { destroy() {} }
  }

  let scope = null
  let explorer = null
  let currentTab = 'train'
  let play = null

  function progressOf() {
    return state.progress[opening.id] || {}
  }
  function pool() {
    return scope ? linesUnder(lines, scope.path) : lines
  }
  function renderCounts() {
    const p = progressOf()
    const counts = { mastered: 0, learning: 0, review: 0, new: 0 }
    lines.forEach((l) => counts[statusOf(p, l.id)]++)
    for (const k in counts) countsEl.querySelector(`.cnt-${k}`).textContent = counts[k]
    for (const k of ['mastered', 'learning', 'review']) countsEl.querySelector(`.seg.${k}`).style.width = `${(counts[k] / lines.length) * 100}%`
    linesCountEl.textContent = lines.length
  }
  // persist(lineId, errors, weak) : `weak` (chantier X2) vient de onFinish(errors, { weak }) du drill.
  // Patché dans le RÉSULTAT de recordRun, jamais dans son entrée : recordRun doit recevoir l'entrée
  // précédente INTACTE (progressOf(), sans rien y ajouter) pour retomber correctement sur ses propres
  // valeurs par défaut quand la ligne n'a encore aucune entrée - la patcher AVANT créerait une entrée
  // partielle (juste { weak }), que recordRun prendrait alors pour une entrée EXISTANTE incomplète
  // (`prev.runs` undefined + 1 = NaN, sérialisé `null`) au lieu de ses défauts complets. `weak`
  // undefined (drill sans `learn`, ne devrait plus arriver ici mais reste supporté) : ne touche pas au
  // champ, recordRun le porte tel quel depuis l'entrée précédente.
  // Rend les faits de jeu du passage (spec V2 L10) : phase ('new' ligne neuve, 'due' révision à
  // l'échéance, 'extra' hors échéance) et passage au statut maîtrisé.
  async function persist(lineId, errors, weak, aided) {
    const now = Date.now()
    const prev = progressOf()[lineId]
    const phase = !prev ? 'new' : prev.due <= now ? 'due' : 'extra'
    const wasMastered = statusOf(progressOf(), lineId) === 'mastered'
    const next = recordRun(progressOf(), lineId, errors, now, { aided })
    const patched = weak !== undefined ? { ...next, [lineId]: { ...next[lineId], weak } } : next
    await saveProgress(opening.id, patched)
    renderCounts()
    if (currentTab === 'lines') renderLines()
    return { phase, becameMastered: !wasMastered && statusOf(patched, lineId) === 'mastered' }
  }

  // learnFor(line) : la config `learn` du cycle Découvrir/Rappeler/Réviser pour CETTE ligne, calculée
  // à chaque tirage (src/core/learn.js, pur) à partir de l'état de progression courant. `explainData`
  // est capturé une fois par écran (chargement de l'ouverture juste au-dessus) : la fiche d'une
  // ouverture pas encore expliquée (module src/explain/index.js pas encore écrit, ou explications pas
  // encore calculées) montre quand même la flèche, avec le texte de repli (cardFor, plus haut).
  function learnFor(line) {
    const p = progressOf()
    return {
      phases: phasesFor(statusOf(p, line.id)),
      knownPrefix: knownPrefixLength(line, lines, p),
      weak: p[line.id]?.weak || [],
      explain: explainData,
    }
  }

  // createDrill() : la brique plateau + feuille de partie pour une ligne. Extrait en fonction pour
  // pouvoir en recréer une neuve au retour du mode partie (section 6), qui détruit temporairement le
  // drill pour monter mountPlay() dans le même conteneur (drillHost, même grille CSS 2 colonnes).
  function createDrill() {
    let hud = null
    const d = mountLineDrill(drillHost, {
      sideEn,
      t,
      locale: state.settings.locale,
      guided: eloToBand(state.settings.elo, state.settings.eloSource) === 'debutant',
      getSounds: () => state.settings.sounds,
      onMoveResult: (ok) => (ok ? hud?.correct() : hud?.miss()),
      onFinish: (errors, { weak, aided, checkmate, own, ms } = {}) => {
        const line = d.currentLine
        persist(line.id, errors, weak, aided).then(({ phase, becameMastered }) => {
          if (d.currentLine !== line) return
          const st = statusOf(progressOf(), line.id)
          const ending = lineEnding({ evals: line.evals, moves: line.moves, side: sideEn, checkmate })
          const res = game?.recordLine({
            openingId: opening.id, lineId: line.id, phase, errors, aided, own, ms, checkmate, becameMastered,
            comboMax: hud?.comboMax ?? 0, moveXp: hud?.lineXp ?? 0,
          })
          if (res) hud?.lineEnd(res)
          const gain = res ? t('session.xp', { xp: res.xp }) : ''
          d.setFeedback(errors ? 'warn' : 'good', errors
            ? t('train.finishedErrors', { errors, verdict: verdictText(ending, t), gain })
            : t('train.finishedPerfect', { verdict: verdictText(ending, t), status: t(`status.${st}`), gain }))
          // Fin de ligne (section 6) : propose de continuer contre Stockfish depuis cette position,
          // seulement si un moteur existe (Tauri, ou un moteur factice de test en web, engineFor()), et
          // seulement si la position n'est pas réellement mat (un mat seulement forcé se joue encore).
          continueBtn.hidden = !engineFor() || ending.kind === 'checkmate'
          nextBtn.hidden = true
          inlineNext.hidden = false
        })
      },
    })
    const inlineNext = document.createElement('button')
    inlineNext.type = 'button'
    inlineNext.className = 'drill-next'
    inlineNext.textContent = t('train.nextLine')
    inlineNext.hidden = true
    inlineNext.addEventListener('click', next)
    drillHost.querySelector('.feedback').after(inlineNext)
    if (game) hud = mountHud(drillHost, game, { getOpeningId: () => opening.id, getLineId: () => d.currentLine?.id, getSounds: () => state.settings.sounds, getLocale: () => state.settings.locale })
    // startLine garde une trace de la ligne en cours pour que onFinish sache laquelle enregistrer.
    const rawSetLine = d.setLine
    d.setLine = (line, opts) => { inlineNext.hidden = true; nextBtn.hidden = false; d.currentLine = line; hud?.startLine(); rawSetLine(line, opts) }
    const rawRestart = d.restart
    d.restart = () => { hud?.startLine(); rawRestart() }
    return d
  }
  let drill = createDrill()

  function next() {
    continueBtn.hidden = true
    const p = progressOf()
    const candidates = pool()
    const chosen = pickNextLine(candidates, p, { currentId: drill.currentLine?.id, now: Date.now() })
    if (chosen) drill.setLine(chosen, { learn: learnFor(chosen) })
  }
  function setScope(next) {
    scope = next
    scopeEl.hidden = !scope
    if (scope) scopeNameEl.textContent = scope.label
  }

  // ---------- mode partie (section 6) : continuer contre Stockfish depuis fen, mon camp joue tous
  // les coups légaux, l'adversaire répond avec l'Elo des réglages. Réutilise drillHost (mountPlay y
  // rend .board-col + .drill-info, la même forme que mountLineDrill) : le drill est détruit pendant
  // la partie, puis reconstruit au retour (exitPlay).
  function enterPlay(fen) {
    const engine = engineFor()
    if (!engine) return
    drill.destroy()
    host.querySelectorAll('[role="tab"]').forEach((b) => { b.disabled = true })
    setActions({}) // pas de raccourcis pendant la partie : 'n'/'i'/'r' n'ont pas de sens ici
    hintBtn.hidden = true
    restartBtn.hidden = true
    nextBtn.hidden = true
    continueBtn.hidden = true
    resignBtn.hidden = false
    resignBtn.disabled = false
    exitPlayBtn.hidden = false
    play = mountPlay(drillHost, {
      fen,
      sideEn,
      engine,
      elo: state.settings.elo,
      t,
      getSounds: () => state.settings.sounds,
      onOver: () => { resignBtn.disabled = true },
    })
  }
  function exitPlay() {
    play?.destroy()
    play = null
    host.querySelectorAll('[role="tab"]').forEach((b) => { b.disabled = false })
    resignBtn.hidden = true
    exitPlayBtn.hidden = true
    hintBtn.hidden = false
    restartBtn.hidden = false
    nextBtn.hidden = false
    drill = createDrill()
    registerActions()
    next()
  }

  function renderLines() {
    const p = progressOf()
    const groups = new Map()
    lines.forEach((l) => { if (!groups.has(l.group)) groups.set(l.group, []); groups.get(l.group).push(l) })
    linesPane.innerHTML = ''
    for (const [name, ls] of groups) {
      const sec = document.createElement('section')
      sec.className = 'group'
      const done = ls.filter((l) => statusOf(p, l.id) === 'mastered').length
      sec.innerHTML = `<h3><span class="mono">${name}</span><small>${done}/${ls.length}</small></h3>`
      const ul = document.createElement('ul')
      for (const l of ls) {
        const st = statusOf(p, l.id)
        const li = document.createElement('li')
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'line-row'
        b.innerHTML = `<i class="dot ${st}" aria-hidden="true"></i><span class="mono">${l.name}</span><small>${t(`status.${st}`)} · ${t('train.lineMoves', { count: Math.ceil(l.moves.length / 2) })}</small>`
        b.addEventListener('click', () => { setScope(null); switchTab('train'); drill.setLine(l, { learn: learnFor(l) }) })
        li.append(b)
        ul.append(li)
      }
      sec.append(ul)
      linesPane.append(sec)
    }
  }

  function switchTab(tab) {
    currentTab = tab
    host.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
    for (const t of ['train', 'explore', 'lines']) host.querySelector(`[data-pane="${t}"]`).hidden = t !== tab
    if (tab === 'train') drill.redraw()
    if (tab === 'explore') {
      if (!explorer) {
        // Le panneau vient de passer de hidden à visible sur cette même passe : sans forcer une
        // remise à plat ici, chessground lirait des dimensions de 0 (aucune mise en page encore
        // calculée) et dessinerait ses flèches d'indice à des coordonnées NaN (erreurs console).
        void explorePane.offsetHeight
        explorer = mountExplorer(explorePane, {
          tree,
          sideEn,
          t,
          onDrill: (path) => {
            const label = path.map((s, k) => moveLabel(k, s)).join(' ')
            setScope({ path, label })
            switchTab('train')
            next()
          },
          onPlay: (fen) => {
            switchTab('train')
            enterPlay(fen)
          },
        })
      } else explorer.redraw()
      // Ouverture depuis n'importe quelle position de l'arbre (section 6) : revérifié à chaque
      // passage sur l'onglet, pas seulement à la création, pour suivre un moteur posé après coup
      // (window.__theorieSetEngine, smoke test web).
      explorer.setPlayVisible(!!engineFor())
    }
    if (tab === 'lines') renderLines()
  }
  host.querySelectorAll('[role="tab"]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)))
  host.querySelector('.scope-clear').addEventListener('click', () => { setScope(null); next() })
  nextBtn.addEventListener('click', next)
  restartBtn.addEventListener('click', () => { continueBtn.hidden = true; drill.restart() })
  hintBtn.addEventListener('click', () => drill.hint())
  continueBtn.addEventListener('click', () => { if (drill.currentLine) enterPlay(drill.getFen()) })
  resignBtn.addEventListener('click', () => play?.resign())
  exitPlayBtn.addEventListener('click', exitPlay)

  function registerActions() {
    setActions({
      next,
      hint: () => drill.hint(),
      restart: () => drill.restart(),
      'tab:train': () => switchTab('train'),
      'tab:explore': () => switchTab('explore'),
      'tab:lines': () => switchTab('lines'),
      'explore:back': () => { if (currentTab === 'explore') explorer?.back() },
      'explore:forward': () => { if (currentTab === 'explore') explorer?.forward() },
    })
  }
  registerActions()

  renderCounts()
  next()
  if (params.tab && params.tab !== 'train') switchTab(params.tab)

  return {
    destroy() {
      // Partie en cours (mode partie, section 6) : drill est déjà détruit (enterPlay), donc ne pas
      // le détruire une 2e fois ; sinon c'est le drill qui est monté, comme d'habitude.
      if (play) play.destroy()
      else drill.destroy()
      explorer?.destroy()
    },
  }
}
