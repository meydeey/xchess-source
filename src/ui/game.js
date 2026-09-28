// Contrôleur du jeu (spec V2 L10, ADR-0007) : tient le journal d'activité (clé `activity` du store),
// dérive l'état de jeu (src/core/game.js, pur) et joue les célébrations : XP qui monte à chaque coup
// juste, combo, passage de niveau, trophée, défi relevé, objectif atteint, coffre. Les écrans lui
// passent des faits (ligne terminée, Rush fini) ; il ne connaît ni le plateau ni les arbres.
import * as core from '../core/game.js'
import { localDateStr } from '../core/srs.js'
import { selection, openings, fullIndex } from '../data.js'
import { resolveOpening } from './shared.js'
import * as sound from './sound.js'
import { t } from '../i18n.js'
import { ACHIEVEMENT_ICONS } from './achievement-visuals.js'

const COMBO_IDLE_MS = 10 * 60000 // un combo resté 10 min sans coup s'éteint
const TOAST_MS = 4500

export function createGame({ state, store, persister, journal = null, navigate }) {
  let events = []
  let game = null
  let combo = 0
  let comboAt = 0
  const listeners = new Set()
  const metaCache = new Map()
  let pickCache = { day: null, id: null }

  function meta(id) {
    if (!metaCache.has(id)) {
      const o = resolveOpening(id, { selection, openings })
      metaCache.set(id, o ? { side: o.side, eco: o.eco, name: o.name, lichessName: o.lichessName } : null)
    }
    return metaCache.get(id)
  }
  const nameOf = (id) => {
    const opening = meta(id)
    return opening ? state.settings.locale === 'fr' ? opening.name : opening.lichessName || opening.name : null
  }
  const tr = (key, values) => t(state.settings.locale, key, values)
  const goal = () => state.settings.dailyGoal || core.DEFAULT_GOAL

  function derive(now = Date.now()) {
    game = core.deriveGame(events, { now, goal: goal(), legacyDays: core.progressDays(state.progress), meta })
    return game
  }

  async function load() {
    try { events = journal ? await journal.allActivity() : (await store.get('activity')) || [] } catch { events = [] }
    if (!events.some((e) => e.kind === 'history')) {
      const h = core.historyFromProgress(state.progress)
      // Daté du 1er janvier 1970 : ces ouvertures comptent comme jouées avant tout jour réel (la
      // découverte du jour ne les propose jamais) et ce jour ne compte pas dans la série.
      if (h.data.lines) append(core.newEvent('history', { at: 0, xp: h.xp, data: h.data }), { quiet: true })
    }
    derive()
  }

  function append(event, { quiet = false } = {}) {
    const before = quiet ? null : derive()
    events = [...events, event]
    if (journal) journal.appendActivity(event)
    else persister.write('activity', events)
    const after = derive()
    if (before) celebrate(before, after)
    for (const fn of listeners) fn(after)
    return after
  }

  // ---------- découverte du jour ----------
  // Parmi les ouvertures du catalogue complet (hors alias de la sélection), jamais jouées avant
  // aujourd'hui : stable toute la journée, même après l'avoir jouée.
  function pickOfDay(now = Date.now()) {
    const day = localDateStr(now)
    if (pickCache.day !== day) {
      const g = game || derive(now)
      const playedBefore = new Set([...g.firstDay].filter(([, d]) => d < day).map(([id]) => id))
      const pool = openings.filter((o) => !fullIndex.entries?.[o.id]?.alias)
      pickCache = { day, id: core.dailyPick(day, pool, playedBefore) }
    }
    return pickCache.id
  }

  // Multiplicateur d'XP d'une ouverture en ce moment : coffre « XP ×2 » actif, découverte du jour.
  // Avec une ligne : la même ligne rejouée le même jour rapporte 2 fois moins, puis 4 fois moins
  // (répéter en bloc apprend moins que revenir plus tard, spec V2 §3).
  function multiplierFor(openingId, now = Date.now(), lineId = null) {
    const g = game || derive(now)
    const base = (g.boost && g.boost.until > now ? 2 : 1) * (openingId && openingId === pickOfDay(now) ? 2 : 1)
    return lineId ? base * repeatFactor(openingId, lineId, now) : base
  }
  function repeatFactor(openingId, lineId, now = Date.now()) {
    const day = localDateStr(now)
    const key = core.lineKey(lineId)
    const n = events.filter((e) => e.kind === 'line' && e.day === day && e.data?.o === openingId && e.data?.l === key).length
    return n === 0 ? 1 : n === 1 ? 0.5 : 0.25
  }

  // ---------- combo ----------
  function hit(openingId, lineId) {
    const now = Date.now()
    if (now - comboAt > COMBO_IDLE_MS) combo = 0
    combo++
    comboAt = now
    const mult = multiplierFor(openingId, now, lineId)
    return { xp: core.moveXp(combo, mult), combo, mult: core.comboMultiplier(combo) * mult }
  }
  function miss() {
    const lost = combo
    combo = 0
    return lost
  }

  // recordLine(facts) : un passage de ligne terminé. `moveXp` = XP déjà gagnée coup par coup (HUD).
  function recordLine({ openingId, lineId, phase, errors, aided = false, own, ms, checkmate, becameMastered, comboMax, moveXp = 0 }) {
    const mult = multiplierFor(openingId, Date.now(), lineId)
    const bonuses = core.lineBonuses({ phase, errors, becameMastered, checkmate })
    const bonusXp = Math.round(bonuses.reduce((s, b) => s + b.xp, 0) * mult)
    const xp = moveXp + bonusXp
    append(core.newEvent('line', {
      xp,
      data: { o: openingId, l: core.lineKey(lineId), ph: phase, own, err: errors, aided, ms, mate: !!checkmate, mst: !!becameMastered, combo: comboMax },
    }))
    return { xp, bonuses, mult }
  }
  function recordRush({ score, errors, ms }) {
    const record = score > 0 && score > (game || derive()).counters.rushBest
    const xp = core.rushXp(score, record)
    append(core.newEvent('rush', { xp, data: { score, err: errors, ms } }))
    return { xp, record }
  }
  function recordPuzzle({ id, result, errors, aided = false, cat }) {
    const xp = result === 'solved' ? (errors === 0 ? 10 : 3) : 0
    append(core.newEvent('puzzle', { xp, data: { ref: id, result, errors, aided, cat } }))
    return { xp }
  }
  function recordDrill({ ref, errors, aided }) {
    append(core.newEvent('drill', { xp: errors || aided ? 2 : 10, data: { ref, errors, aided } }))
  }
  // Défis du jour : tirés et figés au 1er passage de la journée sur Aujourd'hui.
  function ensureQuests(ctx) {
    const g = derive()
    if (g.today.questsGenerated) return g
    const day = localDateStr(Date.now())
    const list = core.generateQuests(day, { ...core.questContext(g, { ...ctx, goal: goal(), pick: pickOfDay(), today: day }), challengeFocus: ctx.challengeFocus, personalDue: ctx.personalDue })
    return append(core.newEvent('quests', { data: { list, goal: goal() } }), { quiet: true })
  }
  function openChest() {
    const g = derive()
    if (!g.today.chest.available) return null
    const reward = core.chestReward(localDateStr(Date.now()))
    sound.play('chest', { sounds: state.settings.sounds })
    append(core.newEvent('chest', { xp: reward.xp, data: { reward } }))
    return reward
  }

  // ---------- célébrations ----------
  function celebrate(before, after) {
    const sounds = state.settings.sounds
    const queue = []
    const doneBefore = new Set(before.today.quests.filter((q) => q.done).map((q) => q.id))
    for (const q of after.today.quests) {
      if (q.done && !doneBefore.has(q.id)) queue.push({ tone: 'quest', title: tr('game.questDone'), text: `${tr(`quest.${q.kind}`, { count: q.target, side: q.side ? tr(`side.${q.side}`) : '', opening: nameOf(q.openingId) ? `: ${nameOf(q.openingId)}` : '' })} · +${q.xp} XP` })
    }
    const tierBefore = new Map(before.achievements.map((a) => [a.id, a.tier]))
    for (const a of after.achievements) {
      if (a.tier > (tierBefore.get(a.id) || 0)) {
        const label = a.tiers.length > 1 ? ` (${tr(`progress.tier.${a.tier - 1}`)})` : ''
        queue.push({ tone: 'trophy', title: tr('game.trophyUnlocked'), text: `${tr(`achievement.${a.id}.name`)}${label}`, href: '#/progress/trophies', icon: ACHIEVEMENT_ICONS[a.id] })
      }
    }
    if (after.today.goalMet && !before.today.goalMet) queue.push({ tone: 'goal', title: tr('game.goalReached'), text: tr('game.todayXp', { xp: after.today.xp }) })
    if (after.streak.todayActive && !before.streak.todayActive && after.streak.current > 1) {
      queue.push({ tone: 'streak', title: tr('game.streak', { days: after.streak.current }), text: tr('game.streakTomorrow') })
    }
    if (after.today.chest.available && !before.today.chest.available) {
      queue.push({ tone: 'chest', title: tr('game.chestReady'), text: tr('game.chestChallenges'), href: '#/' })
    }
    queue.forEach((t, i) => setTimeout(() => toast(t), i * 700))
    if (queue.some((t) => t.tone === 'trophy')) setTimeout(() => sound.play('achievement', { sounds }), 700)
    else if (queue.length) setTimeout(() => sound.play('quest', { sounds }), 700)
    if (after.level.level > before.level.level) setTimeout(() => levelUp(after.level), 1200)
  }

  function toast({ tone, title, text, href, icon }) {
    const host = document.getElementById('game-toasts')
    if (!host) return
    const el = document.createElement(href ? 'a' : 'div')
    el.className = 'game-toast'
    el.dataset.tone = tone
    if (href) el.href = href
    el.innerHTML = icon
      ? `<span class="toast-symbol" aria-hidden="true"></span><span class="toast-copy"><b></b><small></small></span><span class="toast-sparkle" aria-hidden="true">✦</span>`
      : `<b></b><span></span>`
    if (icon) el.querySelector('.toast-symbol').textContent = icon
    el.querySelector('b').textContent = title
    el.querySelector(icon ? 'small' : 'span').textContent = text
    host.append(el)
    setTimeout(() => el.classList.add('out'), TOAST_MS)
    setTimeout(() => el.remove(), TOAST_MS + 400)
  }

  function levelUp(level) {
    const el = document.getElementById('levelup')
    if (!el) return
    sound.play('levelup', { sounds: state.settings.sounds })
    const titleChanged = core.titleOf(level.level - 1) !== level.title
    const titleKey = core.TITLES.filter(([min]) => min <= level.level).at(-1)[0]
    el.querySelector('.levelup-level').textContent = tr('today.level', { level: level.level })
    el.querySelector('.levelup-title').textContent = titleChanged ? tr('game.newTitle', { title: tr(`title.${titleKey}`) }) : tr(`title.${titleKey}`)
    el.querySelector('.levelup-next').textContent = level.nextTitle
      ? tr('progress.nextTitle', { title: tr(`title.${level.nextTitle.level}`), level: level.nextTitle.level })
      : tr('progress.allTitles')
    const confetti = el.querySelector('.confetti')
    confetti.innerHTML = Array.from({ length: 40 }, () => `<i style="--x:${Math.round(Math.random() * 100)};--d:${Math.round(Math.random() * 10)};--h:${Math.round(Math.random() * 360)};--r:${Math.round(Math.random() * 900 - 450)}deg"></i>`).join('')
    el.hidden = false
    const close = () => { el.hidden = true }
    el.querySelector('.levelup-close').onclick = close
    el.onclick = (ev) => { if (ev.target === el) close() }
  }

  return {
    load,
    derive,
    get state() { return game || derive() },
    get events() { return events },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    pickOfDay,
    multiplierFor,
    hit,
    miss,
    get combo() { return combo },
    recordLine,
    recordRush,
    recordPuzzle,
    recordDrill,
    ensureQuests,
    openChest,
    nameOf,
    meta,
    navigate,
  }
}

// ---------- HUD d'un plateau : combo et XP en direct ----------
// mountHud(drillHost, game, { getOpeningId }) : se loge dans le `.hud-slot` du drill (trainer.js) et
// fait monter les « +XP » au-dessus du plateau. correct() et miss() suivent chaque coup du rappel ;
// lineEnd() affiche les bonus de fin de ligne ; startLine() remet le compteur de la ligne à 0.
export function mountHud(drillHost, game, { getOpeningId, getLineId = () => null, getSounds = () => true, getLocale = () => 'fr' }) {
  const slot = drillHost.querySelector('.hud-slot')
  const frame = drillHost.querySelector('.board-frame')
  if (!slot) return null
  slot.innerHTML = `
    <div class="hud" aria-live="polite">
      <span class="hud-combo" data-tier="0"><b class="mono">0</b> ${t(getLocale(), 'game.combo')} <i class="hud-mult mono" hidden></i></span>
      <span class="hud-xp"><b class="mono">+0</b> ${t(getLocale(), 'game.lineXp')}</span>
      <span class="hud-boost mono" hidden></span>
    </div>
  `
  const comboEl = slot.querySelector('.hud-combo')
  const comboNum = comboEl.querySelector('b')
  const multEl = slot.querySelector('.hud-mult')
  const xpEl = slot.querySelector('.hud-xp b')
  const boostEl = slot.querySelector('.hud-boost')
  let lineXp = 0
  let comboMax = 0

  function tierOf(c) {
    return c >= 50 ? 3 : c >= 25 ? 2 : c >= 10 ? 1 : 0
  }
  // Le bandeau de bonus se calcule au début de la ligne : après son enregistrement, la même ligne
  // compterait comme déjà jouée et afficherait à tort une XP réduite pour le passage qui vient de finir.
  function paintBoost() {
    const bonus = game.multiplierFor(getOpeningId(), Date.now(), getLineId())
    boostEl.hidden = bonus === 1
    boostEl.dataset.tone = bonus < 1 ? 'low' : 'high'
    boostEl.textContent = bonus < 1 ? t(getLocale(), 'game.replayedXp', { multiplier: new Intl.NumberFormat(getLocale()).format(bonus) }) : `XP ×${bonus}`
  }
  function paint() {
    const c = game.combo
    comboNum.textContent = c
    comboEl.dataset.tier = tierOf(c)
    const m = core.comboMultiplier(c)
    multEl.hidden = m === 1
    multEl.textContent = `×${new Intl.NumberFormat(getLocale()).format(m)}`
    xpEl.textContent = `+${lineXp}`
  }
  function float(text, tone = 'good') {
    if (!frame) return
    const el = document.createElement('span')
    el.className = 'xp-float'
    el.dataset.tone = tone
    el.textContent = text
    frame.append(el)
    setTimeout(() => el.remove(), 1100)
  }
  function bump() {
    comboEl.classList.remove('bump')
    void comboEl.offsetWidth
    comboEl.classList.add('bump')
  }
  paint()
  paintBoost()
  return {
    correct() {
      const r = game.hit(getOpeningId(), getLineId())
      lineXp += r.xp
      comboMax = Math.max(comboMax, r.combo)
      float(`+${r.xp}`)
      bump()
      if (r.combo % 5 === 0) sound.play('combo', { sounds: getSounds(), level: r.combo })
      paint()
    },
    miss() {
      const lost = game.miss()
      if (lost >= 5) float(t(getLocale(), 'game.comboLost', { count: lost }), 'bad')
      paint()
    },
    startLine() {
      lineXp = 0
      comboMax = game.combo
      paint()
      paintBoost()
    },
    lineEnd({ xp, bonuses, mult }) {
      bonuses.forEach((b, i) => setTimeout(() => float(`+${Math.round(b.xp * mult)} ${t(getLocale(), `bonus.${b.key}`)}`, 'bonus'), 250 + i * 380))
      lineXp = xp
      paint()
    },
    get lineXp() { return lineXp },
    get comboMax() { return comboMax },
    refresh: paint,
  }
}

// ---------- pastille du joueur (en-tête) ----------
// Niveau, barre d'XP, série et objectif du jour, toujours visibles : cliquer mène à Progrès.
export function renderChip(el, g, locale = 'fr') {
  if (!el) return
  const goalPct = Math.min(100, Math.round((g.today.xp / g.today.goal) * 100))
  el.innerHTML = `
    <span class="chip-level">${t(locale, 'header.level', { level: g.level.level })}</span>
    <progress class="chip-bar" value="${g.level.into}" max="${g.level.span}" aria-hidden="true"></progress>
    <span class="chip-streak${g.streak.todayActive ? ' on' : ''}" title="${t(locale, 'header.streak', { days: g.streak.current })}">${flameSvg()}<b class="mono">${g.streak.current}</b></span>
    <span class="chip-goal${g.today.goalMet ? ' met' : ''}" title="${t(locale, 'header.goal', { xp: g.today.xp, goal: g.today.goal })}" style="--p:${goalPct}">${g.today.goalMet ? '' : `<b class="mono">${goalPct}</b>`}</span>
  `
  el.setAttribute('aria-label', t(locale, 'header.summary', { level: g.level.level, into: g.level.into, span: g.level.span, days: g.streak.current, xp: g.today.xp, goal: g.today.goal }))
}
export function flameSvg() {
  return '<svg class="flame" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c.6 3.2 2.3 4.9 3.9 6.6C17.6 10.4 19 12.2 19 15a7 7 0 0 1-14 0c0-2.3 1-4 2.4-5.4.2 1.6.9 2.8 2.1 3.4C9 9.5 10.2 5.4 12 2z"/></svg>'
}
