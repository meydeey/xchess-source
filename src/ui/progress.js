import { selection, openings, catalogMeta } from '../data.js'
import { statusOf } from '../core/srs.js'
import { progressDays, sortEvents, TITLES } from '../core/game.js'
import { buildSession } from '../core/session.js'
import { resolveOpening, getCachedLines, escapeHtml } from './shared.js'
import * as statsScreen from './stats.js'
import { t } from '../i18n.js'
import { ACHIEVEMENT_ICONS, TIER_ICONS } from './achievement-visuals.js'
import { challengeArt, rankMedallion } from './reward-art.js'
import '../visual-progress.css'

const OVERVIEW_TABS = ['activity', 'memory']
const DETAILS = ['path', 'cards', 'trophies', 'atlas', 'stats']
const VOLUMES = ['A', 'B', 'C', 'D', 'E']
const PRACTICE_KINDS = ['line', 'puzzle', 'drill', 'rush']
const SHORTCUTS = [
  ['#/progress/path', 'progress.path'],
  ['#/progress/cards', 'progress.cards'],
  ['#/progress/trophies', 'progress.trophies'],
  ['#/games', 'coach.myGames'],
  ['#/progress/atlas', 'progress.atlas'],
  ['#/progress/stats', 'progress.stats'],
]

export async function mount(host, ctx) {
  const { params, game, state } = ctx
  const locale = state.settings.locale
  const tr = (key, values) => t(locale, key, values)
  const tab = [...OVERVIEW_TABS, ...DETAILS].includes(params.tab) ? params.tab : 'activity'
  const g = game.derive()
  let sub

  if (OVERVIEW_TABS.includes(tab)) {
    const practice = game.events.filter((event) => PRACTICE_KINDS.includes(event.kind))
    const days = progressDays(state.progress)
    for (const event of practice) if (event.day) days.add(event.day)
    host.innerHTML = `
      <div class="progress-page progress-overview-page">
        <h1 class="progress-page-title">${tr('nav.progress')}</h1>
        ${metrics(g, days.size, tr, locale)}
        <div class="progress-layout">
          <section class="progress-panel">
            <nav class="progress-tabs" aria-label="${tr('nav.progress')}">
              ${OVERVIEW_TABS.map((id) => `<a data-tab="${id}" href="#/progress/${id}"${id === tab ? ' aria-current="page"' : ''}>${tr(`progress.${id}`)}</a>`).join('')}
            </nav>
            <div class="progress-tab-content"></div>
          </section>
          <nav class="progress-shortcuts" aria-label="${tr('progress.shortcuts')}">
            ${SHORTCUTS.map(([href, key]) => `<a href="${href}">${tr(key)}<span aria-hidden="true">›</span></a>`).join('')}
          </nav>
        </div>
      </div>
    `
    const content = host.querySelector('.progress-tab-content')
    content.innerHTML = tab === 'memory' ? await memory(state, tr, locale) : activity(practice, tr, locale)
  } else {
    host.innerHTML = `
      <div class="progress-page progress-detail-page">
        <header class="progress-detail-heading">
          <a class="progress-return" href="#/progress"><span aria-hidden="true">‹</span> ${tr('nav.progress')}</a>
          <h1>${tr(`progress.${tab}`)}</h1>
        </header>
        <div class="progress-body"></div>
      </div>
    `
    const body = host.querySelector('.progress-body')
    if (tab === 'path') body.innerHTML = pathView(await ctx.getChallengePath(), await ctx.getMastery(), tr)
    else if (tab === 'cards') body.innerHTML = cardsView(await ctx.getMastery(), tr, locale)
    else if (tab === 'trophies') body.innerHTML = trophies(g, tr, locale)
    else if (tab === 'atlas') body.innerHTML = await atlas(ctx, tr)
    else {
      body.innerHTML = `<div class="stats-host"></div>${xpHistory(g, tr, locale)}`
      sub = await statsScreen.mount(body.querySelector('.stats-host'), { ...ctx, embedded: true })
    }
  }
  return { destroy() { sub?.destroy?.() } }
}

function metrics({ counters, level }, days, tr, locale) {
  const num = new Intl.NumberFormat(locale)
  const values = [
    ['progress.record.lines', counters.lines],
    ['progress.record.puzzles', counters.puzzlesSolved],
    ['progress.practiceDays', days],
  ]
  return `<a class="progress-rank" href="#/progress/trophies">
    ${rankMedallion(level.level)}
    <strong>${tr('header.level', { level: level.level })}</strong>
    <span class="mono">${num.format(level.into)} / ${num.format(level.span)} XP</span>
    <span aria-hidden="true">›</span>
  </a><dl class="progress-metrics">${values.map(([key, value]) => `
    <div class="progress-metric">
      <dt>${tr(key)}</dt>
      <dd>${num.format(value)}</dd>
    </div>
  `).join('')}</dl>`
}

function openingName(opening, locale) {
  return locale === 'fr' ? opening.name : opening.lichessName || opening.name
}

function activity(practice, tr, locale) {
  const completed = practice.filter((event) => Number.isFinite(event.at) && (event.kind !== 'puzzle' || event.data?.result === 'solved'))
  const recent = sortEvents(completed).slice(-5).reverse()
  if (!recent.length) return `
    <div class="progress-empty">
      <h2>${tr('progress.activityEmpty')}</h2>
      <p>${tr('coach.firstLead')}</p>
      <a class="cta primary" href="#/first-opening">${tr('coach.firstStart')}</a>
    </div>
  `
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const describe = (event) => {
    switch (event.kind) {
      case 'line': {
        const opening = resolveOpening(event.data?.o, { selection, openings })
        return opening ? [openingName(opening, locale), `#/opening/${encodeURIComponent(opening.id)}`] : [tr('nav.library'), '#/library']
      }
      case 'puzzle': return [tr('exercises.title'), '#/exercises/mixed']
      case 'drill': return [tr('coach.myGames'), '#/games']
      default: return ['Rush', '#/rush']
    }
  }
  return `<ul class="progress-entries">${recent.map((event) => {
    const [name, href] = describe(event)
    return `<li><a href="${href}">${escapeHtml(name)}</a><time datetime="${escapeHtml(event.day)}">${date.format(event.at)}</time></li>`
  }).join('')}</ul>`
}

async function memory(state, tr, locale) {
  const now = Date.now()
  const repertoire = state.repertoire.filter((id) => Object.values(state.progress[id] || {}).some((item) => item?.due <= now))
  const available = (await Promise.all(repertoire.map(async (id) => {
    const opening = resolveOpening(id, { selection, openings })
    return opening ? [id, { opening, lines: (await getCachedLines(opening)).lines }] : null
  }))).filter(Boolean)
  const { queue } = buildSession({
    repertoire,
    linesByOpening: Object.fromEntries(available.map(([id, { lines }]) => [id, lines])),
    progress: state.progress,
    newPerDay: 0,
    now,
  })
  if (!queue.length) return `
    <div class="progress-empty">
      <h2>${tr('progress.memoryEmpty')}</h2>
      <a class="cta" href="#/library/repertoire">${tr('library.tab.repertoire')}</a>
    </div>
  `
  const counts = new Map()
  for (const { openingId } of queue) counts.set(openingId, (counts.get(openingId) ?? 0) + 1)
  return `
    <div class="progress-review">
      <h2>${tr('progress.memoryReady')}</h2>
      <ul class="progress-entries">${available.map(([id, { opening }]) => counts.has(id) ? `
        <li><a href="#/opening/${encodeURIComponent(id)}">${escapeHtml(openingName(opening, locale))}</a><small>${tr('today.dueShort', { count: counts.get(id) })}</small></li>
      ` : '').join('')}</ul>
      <a class="cta primary" href="#/session/go">${tr('today.start')}</a>
    </div>
  `
}

function pathView(path, mastery, tr) {
  const next = tr(`path.action.${path.next.kind}`)
  const quickLinks = ['#/exercises/mixed', '#/library', '#/exercises/mixed']
  return `
    <section class="card mastery-quick">
      <header><span aria-hidden="true">♙</span><div><h2>${tr('mastery.quickTitle')}</h2><p>${mastery.quickStart.complete ? tr('mastery.quickPlaque') : tr('mastery.quickPending', { count: mastery.quickStart.steps.filter(Boolean).length })}</p></div></header>
      <ol>${mastery.quickStart.steps.map((done, i) => `<li class="${done ? 'done' : ''}"><span aria-hidden="true">${done ? '✓' : i + 1}</span><a href="${quickLinks[i]}"${done ? ` aria-label="${tr(`mastery.quick.${i}`)} : ${tr('path.complete')}"` : ''}>${tr(`mastery.quick.${i}`)}</a></li>`).join('')}</ol>
    </section>
    <section class="card path-intro challenge-banner" data-art="${challengeArt(path.focus.id)}">
      <p class="eyebrow">${tr('path.current')}</p>
      <h2>${tr(`path.stage.${path.focus.id}`)}</h2>
      <p>${tr(path.provisional ? 'path.provisional' : 'path.measured')}</p>
      <a class="cta primary" href="${path.next.href}">${next} ↗</a>
    </section>
    <p class="path-disclaimer">${tr('path.notElo')}</p>
    <h2 class="path-section-title">${tr('mastery.longChallenges')}</h2>
    <div class="path-stages">${path.stages.map((stage, index) => `
      <article class="card path-stage${index === path.focusIndex ? ' current' : ''}${stage.complete ? ' mastered' : ''}">
        <header class="challenge-banner" data-art="${challengeArt(stage.id)}">
          <div><h2>${tr(`path.stage.${stage.id}`)}</h2><small>${tr('path.difficulty', stage)}</small></div>
          ${stage.complete ? `<span class="path-complete">${tr('mastery.pathPlaque')}</span>` : ''}
        </header>
        ${stage.inherited ? `<p class="path-inherited">${tr('path.inherited')}</p>` : ''}
        <div class="path-proofs">
          <a href="#/exercises/mixed/${stage.id}"><b>${tr('path.puzzles')}</b><span>${tr('mastery.puzzleCount', { count: stage.puzzle.attempted, target: stage.count })}</span><span>${tr('path.wins', { wins: stage.puzzle.wins, target: stage.wins })}</span><small>${tr('path.categories', { count: stage.puzzle.categories, target: stage.categories })}</small></a>
          <a href="#/session/go"><b>${tr('path.recall')}</b><span>${tr('path.lines', { count: Math.min(stage.recalled, stage.lines), target: stage.lines })}</span></a>
          ${stage.games ? `<a href="#/games"><b>${tr('path.games')}</b><span>${tr('path.decisions', { count: Math.min(stage.replayed, stage.games), target: stage.games })}</span>${stage.id === 'expert' ? `<small>${tr('mastery.distinctGames', { count: Math.min(stage.distinctGames, 3), target: 3 })}</small>` : ''}</a>` : `<span class="path-foundation"><b>${tr('path.games')}</b><span>${tr('path.later')}</span></span>`}
        </div>
      </article>`).join('')}</div>
  `
}

function cardsView(mastery, tr, locale) {
  const nameOf = (card) => {
    if (card.kind === 'theme') return tr(`theme.${card.id}`)
    const opening = resolveOpening(card.id, { selection, openings })
    return locale === 'fr' ? opening?.name || card.id : opening?.lichessName || opening?.name || card.id
  }
  const cardHtml = (card) => `
    <article class="mastery-card" data-level="${card.level}">
      <header><span class="mastery-symbol" aria-hidden="true">${card.kind === 'theme' ? '♞' : '♜'}</span><div><h3>${escapeHtml(nameOf(card))}</h3><p>${tr(`mastery.level.${card.level}`)}${card.revive ? ` · <strong>${tr('mastery.revive')}</strong>` : ''}</p></div><b class="mono">${card.level}/5</b></header>
      <div class="mastery-pips" aria-label="${tr(`mastery.level.${card.level}`)}">${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= card.level ? 'on' : ''}"></i>`).join('')}</div>
      <p>${card.recent.rate === null ? tr('mastery.recentEmpty') : tr('mastery.recent', card.recent)}</p>
      <p>${card.next ? tr(`mastery.next.${card.next.kind}`, card.next) : tr('mastery.max')}</p>
      ${card.level === 5 ? `<p class="mastery-plaque">♛ ${tr('mastery.cardPlaque')} · ${tr('mastery.level5Proof')}</p>` : ''}
      <a href="${card.href}">${tr('mastery.practice')} ↗</a>
    </article>`
  const themes = mastery.cards.filter((card) => card.kind === 'theme')
  const openingsCards = mastery.cards.filter((card) => card.kind === 'opening').sort((a, b) => nameOf(a).localeCompare(nameOf(b), locale))
  return `
    <section class="card mastery-intro"><h2>${tr('mastery.title')}</h2><p>${tr('mastery.intro')}</p><details><summary>${tr('mastery.max')}</summary><p>${tr('mastery.rules')}</p></details></section>
    <section class="mastery-section"><h2>${tr('mastery.themes')}</h2><div class="mastery-grid">${themes.map(cardHtml).join('')}</div></section>
    <section class="mastery-section"><h2>${tr('mastery.openings')}</h2>${openingsCards.length ? `<div class="mastery-grid">${openingsCards.map(cardHtml).join('')}</div>` : `<p class="muted">${tr('mastery.emptyOpenings')}</p>`}</section>
  `
}

// ---------- Trophées ----------
function trophies(g, tr, locale) {
  const { level, counters, achievements, streak } = g
  const NUM = new Intl.NumberFormat(locale)
  const unlocked = achievements.reduce((s, a) => s + a.tier, 0)
  const total = achievements.reduce((s, a) => s + a.tiers.length, 0)
  const ladder = TITLES.map(([min]) => {
    const state = level.level >= min ? (TITLES.filter(([value]) => value <= level.level).at(-1)[0] === min ? 'current' : 'done') : 'todo'
    return `<li data-state="${state}"><b>${tr(`title.${min}`)}</b><small>${tr('header.level', { level: min })}</small></li>`
  }).join('')
  const records = [
    [counters.comboBest, tr('progress.record.combo')],
    [counters.rushBest, tr('progress.record.rush')],
    [streak.best, tr('progress.record.streak')],
    [NUM.format(counters.lines), tr('progress.record.lines')],
    [`${NUM.format(counters.puzzlesSolved)}/${NUM.format(counters.puzzles)}`, tr('progress.record.puzzles')],
    [NUM.format(counters.masteredLines.size), tr('progress.record.mastered')],
    [NUM.format(counters.openings.size), tr('progress.record.openings')],
  ]
  return `
    <section class="card trophy-head">
      <div class="hero-level">
        ${rankMedallion(level.level)}
        <div>
          <p class="hero-title">${tr(`title.${TITLES.filter(([value]) => value <= level.level).at(-1)[0]}`)} <small>${tr('today.level', { level: level.level })}</small></p>
          <p class="hero-sub mono">${tr('progress.totalXp', { xp: NUM.format(g.xp), unlocked, total })}</p>
          <p class="hero-next">${level.nextTitle ? tr('progress.nextTitle', { title: tr(`title.${level.nextTitle.level}`), level: level.nextTitle.level }) : tr('progress.allTitles')}</p>
        </div>
      </div>
      <ol class="title-ladder">${ladder}</ol>
    </section>
    <div class="records">${records.map(([v, l]) => `<div class="record-tile"><b class="mono">${v}</b><span>${l}</span></div>`).join('')}</div>
    <div class="trophy-grid">
      ${achievements.map((a) => {
        const pct = Math.min(100, Math.round((Math.min(a.value, a.target) / a.target) * 100))
        const medals = a.tiers.map((_, i) => `<span class="trophy-medal${i < a.tier ? ' on' : ''}" aria-label="${tr(a.tiers.length > 1 ? `progress.tier.${i}` : 'progress.unlocked')}${i < a.tier ? ' ✓' : ''}">${a.tiers.length > 1 ? TIER_ICONS[i] : '🌟'}</span>`).join('')
        return `
          <article class="trophy${a.tier ? ' unlocked' : ''}${a.done ? ' done' : ''}">
            <span class="trophy-symbol" aria-hidden="true">${ACHIEVEMENT_ICONS[a.id]}</span>
            <div class="trophy-content">
              <header><b>${tr(`achievement.${a.id}.name`)}</b><span class="medals">${medals}</span></header>
              <p>${tr(`achievement.${a.id}.desc`, { n: a.target })}</p>
              <div class="qbar" aria-hidden="true"><i style="width:${pct}%"></i></div>
              <small class="mono">${a.done ? tr('progress.done') : `${NUM.format(Math.min(a.value, a.target))}/${NUM.format(a.target)}`}</small>
            </div>
          </article>`
      }).join('')}
    </div>
  `
}

// ---------- Atlas ECO ----------
// Niveau d'une case : 0 jamais joué, 1 au moins une ligne jouée, 2 une ligne maîtrisée, 3 une ouverture
// entièrement maîtrisée. Un code absent du catalogue reste grisé.
async function atlas({ state }, tr) {
  const openingsByCode = new Map()
  for (const o of [...openings, ...selection]) {
    if (!o.eco) continue
    if (!openingsByCode.has(o.eco)) openingsByCode.set(o.eco, new Set())
    openingsByCode.get(o.eco).add(o.id)
  }
  const level = new Map()
  const played = new Map()
  for (const [id, sub] of Object.entries(state.progress)) {
    const o = resolveOpening(id, { selection, openings })
    const entries = Object.keys(sub || {})
    if (!o?.eco || !entries.length) continue
    const mastered = entries.filter((lineId) => statusOf(sub, lineId) === 'mastered').length
    const total = catalogMeta(id)?.lines ?? (await getCachedLines(o)).lines.length
    const l = mastered && mastered >= total ? 3 : mastered ? 2 : 1
    level.set(o.eco, Math.max(level.get(o.eco) || 0, l))
    played.set(o.eco, (played.get(o.eco) || 0) + 1)
  }
  const explored = [...level.values()].length
  const mastered = [...level.values()].filter((l) => l >= 2).length
  const volumes = VOLUMES.map((v) => {
    const cells = Array.from({ length: 100 }, (_, i) => {
      const code = `${v}${String(i).padStart(2, '0')}`
      const count = openingsByCode.get(code)?.size || 0
      const lv = level.get(code) || 0
      const title = count
        ? tr('progress.atlasCell', { code, count, played: played.get(code) || 0 })
        : tr('progress.atlasMissing', { code })
      return count
        ? `<a class="eco-cell" data-level="${lv}" href="#/library/catalog/${code}" title="${title}" aria-label="${title}"></a>`
        : `<span class="eco-cell" data-level="none" title="${title}"></span>`
    }).join('')
    const done = [...level.keys()].filter((c) => c[0] === v).length
    return `
      <section class="eco-volume">
        <header><b>${v}</b><span>${tr(`progress.volume.${v}`)}</span><small class="mono">${done}/${[...openingsByCode.keys()].filter((c) => c[0] === v).length}</small></header>
        <div class="eco-grid">${cells}</div>
      </section>`
  }).join('')
  return `
    <section class="atlas">
      <p class="atlas-summary">${tr('progress.atlasSummary', { explored, mastered, total: openingsByCode.size })}</p>
      <p class="atlas-legend">
        <span><i class="eco-cell" data-level="0"></i> ${tr('progress.atlasNever')}</span>
        <span><i class="eco-cell" data-level="1"></i> ${tr('progress.atlasPlayed')}</span>
        <span><i class="eco-cell" data-level="2"></i> ${tr('progress.atlasLineMastered')}</span>
        <span><i class="eco-cell" data-level="3"></i> ${tr('progress.atlasOpeningMastered')}</span>
      </p>
      <div class="eco-volumes">${volumes}</div>
    </section>
  `
}

// ---------- XP des 14 derniers jours ----------
// Barres partant de 0, valeur écrite sous chaque barre, objectif du jour en repère ; résumé textuel
// pour les lecteurs d'écran.
function xpHistory(g, tr, locale) {
  const NUM = new Intl.NumberFormat(locale)
  const DAY_FMT = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' })
  const max = Math.max(g.today.goal, ...g.history.map((h) => h.xp), 1)
  const delta = g.week.prevXp ? Math.round(((g.week.xp - g.week.prevXp) / g.week.prevXp) * 100) : null
  const summary = tr('progress.xpSummary', { days: g.history.map((h) => `${DAY_FMT.format(new Date(`${h.day}T12:00:00`))} ${h.xp}`).join(', ') })
  return `
    <section class="card xp-history">
      <header class="card-head">
        <h2>${tr('progress.xp14')}</h2>
        <span class="muted">${tr('progress.xp7', { xp: NUM.format(g.week.xp) })}${delta != null ? tr('progress.xpDelta', { delta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}` }) : ''}</span>
      </header>
      <div class="xp-bars" role="img" aria-label="${summary}" style="--g:${(g.today.goal / max).toFixed(3)}">
        <span class="xp-goal" title="${tr('progress.xpGoal', { xp: g.today.goal })}"></span>
        ${g.history.map((h) => `
          <div class="xp-col${h.xp >= g.today.goal ? ' met' : ''}">
            <span class="xp-bar" style="height:${(h.xp / max) * 100}%"></span>
            <small class="mono">${h.xp || ''}</small>
            <small>${DAY_FMT.format(new Date(`${h.day}T12:00:00`)).replace('.', '')}</small>
          </div>`).join('')}
      </div>
    </section>
  `
}
