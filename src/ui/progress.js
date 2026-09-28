// Progrès (spec V2 §5.4 et L10) : 3 onglets. Trophées : niveau, échelle des titres, records et
// trophées avec leur palier suivant. Atlas : les 500 codes ECO, allumés à mesure que j'y joue et que
// j'y maîtrise des lignes, chaque case menant au catalogue filtré. Statistiques : XP des 14 derniers
// jours, puis le tableau par ouverture (src/ui/stats.js).
import { selection, openings, catalogMeta } from '../data.js'
import { statusOf } from '../core/srs.js'
import { TITLES } from '../core/game.js'
import { resolveOpening, getCachedLines, escapeHtml } from './shared.js'
import * as statsScreen from './stats.js'
import { t } from '../i18n.js'
import { ACHIEVEMENT_ICONS, TIER_ICONS } from './achievement-visuals.js'

const TABS = [
  { id: 'path', key: 'progress.path' },
  { id: 'cards', key: 'progress.cards' },
  { id: 'trophies', key: 'progress.trophies' },
  { id: 'atlas', key: 'progress.atlas' },
  { id: 'stats', key: 'progress.stats' },
]
const VOLUMES = ['A', 'B', 'C', 'D', 'E']

export async function mount(host, ctx) {
  const { params, game, navigate, state } = ctx
  const tr = (key, values) => t(state.settings.locale, key, values)
  const locale = state.settings.locale
  let tab = TABS.some((t) => t.id === params.tab) ? params.tab : 'path'
  host.innerHTML = `
    <div class="progress-page">
      <div class="progress-heading"><h1>${tr('nav.progress')}</h1><a class="progress-settings" href="#/settings">${tr('nav.settings')}</a></div>
      <div class="tabs" role="tablist" aria-label="${tr('nav.progress')}">
        ${TABS.map((item) => `<button type="button" role="tab" data-tab="${item.id}" aria-selected="${item.id === tab}">${tr(item.key)}</button>`).join('')}
      </div>
      <div class="progress-body"></div>
    </div>
  `
  const body = host.querySelector('.progress-body')
  let sub = null

  async function show(next) {
    tab = next
    host.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
    sub?.destroy?.()
    sub = null
    const g = game.derive()
    if (tab === 'path') body.innerHTML = pathView(await ctx.getChallengePath(), await ctx.getMastery(), tr)
    else if (tab === 'cards') body.innerHTML = cardsView(await ctx.getMastery(), tr, locale)
    else if (tab === 'trophies') body.innerHTML = trophies(g, tr, locale)
    else if (tab === 'atlas') body.innerHTML = await atlas(ctx, tr)
    else {
      body.innerHTML = `<div class="stats-host"></div>${xpHistory(g, tr, locale)}`
      sub = await statsScreen.mount(body.querySelector('.stats-host'), { ...ctx, embedded: true })
    }
  }
  host.querySelectorAll('[role="tab"]').forEach((b) => b.addEventListener('click', () => {
    navigate(`#/progress/${b.dataset.tab}`)
  }))
  await show(tab)
  return { destroy() { sub?.destroy?.() } }
}

function pathView(path, mastery, tr) {
  const next = tr(`path.action.${path.next.kind}`)
  const quickLinks = ['#/exercises/mixed', '#/library', '#/exercises/mixed']
  return `
    <section class="card mastery-quick">
      <header><span aria-hidden="true">♙</span><div><h2>${tr('mastery.quickTitle')}</h2><p>${mastery.quickStart.complete ? tr('mastery.quickPlaque') : tr('mastery.quickPending', { count: mastery.quickStart.steps.filter(Boolean).length })}</p></div></header>
      <ol>${mastery.quickStart.steps.map((done, i) => `<li class="${done ? 'done' : ''}"><span aria-hidden="true">${done ? '✓' : i + 1}</span><a href="${quickLinks[i]}"${done ? ` aria-label="${tr(`mastery.quick.${i}`)} : ${tr('path.complete')}"` : ''}>${tr(`mastery.quick.${i}`)}</a></li>`).join('')}</ol>
    </section>
    <section class="card path-intro">
      <p class="eyebrow">${tr('path.current')}</p>
      <h2>${tr(`path.stage.${path.focus.id}`)}</h2>
      <p>${tr(path.provisional ? 'path.provisional' : 'path.measured')}</p>
      <a class="cta primary" href="${path.next.href}">${next} ↗</a>
    </section>
    <p class="path-disclaimer">${tr('path.notElo')}</p>
    <h2 class="path-section-title">${tr('mastery.longChallenges')}</h2>
    <div class="path-stages">${path.stages.map((stage, index) => `
      <article class="card path-stage${index === path.focusIndex ? ' current' : ''}${stage.complete ? ' mastered' : ''}">
        <header><span class="path-number mono">${String(index + 1).padStart(2, '0')}</span><div><h2>${tr(`path.stage.${stage.id}`)}</h2><small>${tr('path.difficulty', stage)}</small></div>${stage.complete ? `<span class="path-complete">♜ ${tr('mastery.pathPlaque')}</span>` : ''}</header>
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
        <span class="level-badge mono" aria-hidden="true">${level.level}</span>
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
