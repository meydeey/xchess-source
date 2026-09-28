// Aujourd'hui (spec V2 D6 et L10) : l'accueil. Niveau, série et objectif du jour, la séance en 1 geste,
// les 3 défis du jour et leur coffre, le Rush, les ouvertures à raviver (mémoire qui baisse) et la
// découverte du jour. Répertoire vide : le répertoire de départ (D7) en 1 clic.
import { selection, openings, stats, catalogMeta } from '../data.js'
import { buildSession, starterRepertoire } from '../core/session.js'
import { introducedTodayCount } from '../core/stats.js'
import { recentInsights } from '../core/insights.js'
import { openingMemory, rushPositions, TITLES, RUSH, GOALS } from '../core/game.js'
import {
  resolveOpening, getCachedLines, difficultyOf, bandStatsFor, escapeHtml, movesText,
} from './shared.js'
import { flameSvg } from './game.js'

const SECONDS_PER_LINE = 60 // temps médian de départ d'une ligne (spec V2 L3)

function dots(d, t) {
  if (!d) return ''
  return `<span class="lib-dots" aria-label="${t('library.difficulty')} ${t('library.dots', { value: d })}">${'●'.repeat(d)}<span class="lib-dots-off">${'○'.repeat(5 - d)}</span></span>`
}

export async function mount(host, ctx) {
  const { state, band, game, saveRepertoire, navigate, setActions, t } = ctx
  const locale = state.settings.locale
  const DATE_FMT = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  const NUM = new Intl.NumberFormat(locale)
  const formatPct = (value) => value == null ? '-' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  const openingName = (opening) => locale === 'fr' ? opening.name : opening.lichessName || opening.name
  const sideName = (side) => t(`side.${side}`)
  const levelTitle = (level) => t(`title.${TITLES.filter(([min]) => min <= level).at(-1)[0]}`)
  const rewardText = (reward) => {
    if (!reward) return ''
    if (reward.kind === 'xp') return `+${reward.xp} XP`
    if (reward.kind === 'jackpot') return t('today.jackpot', { xp: reward.xp })
    if (reward.kind === 'freeze') return t('today.rewardFreeze')
    if (reward.kind === 'boost') return t('today.rewardBoost', { minutes: reward.minutes || 15 })
    return ''
  }
  const questOpening = (id) => id && resolveOpening(id, { selection, openings })
  const questText = (q) => t(`quest.${q.kind}`, {
    count: q.target, side: q.side ? sideName(q.side) : '',
    opening: questOpening(q.openingId) ? `: ${openingName(questOpening(q.openingId))}` : '',
  })
  setActions({})
  host.innerHTML = `
    <div class="today">
      <header class="today-head"><p class="eyebrow">${DATE_FMT.format(new Date())}</p><h1>${t('today')}</h1></header>
      <div class="today-grid"><p class="empty">${t('today.preparing')}</p></div>
    </div>
  `
  const grid = host.querySelector('.today-grid')

  // Lignes du répertoire et des ouvertures déjà jouées : séance, mémoire et positions du Rush.
  const ids = [...new Set([...state.repertoire, ...Object.keys(state.progress)])]
  const loaded = new Map()
  await Promise.all(ids.map(async (id) => {
    const opening = resolveOpening(id, { selection, openings })
    if (!opening) return
    const { lines, header } = await getCachedLines(opening)
    loaded.set(id, { opening, lines, header })
  }))

  const now = Date.now()
  const linesByOpening = Object.fromEntries(state.repertoire.filter((id) => loaded.has(id)).map((id) => [id, loaded.get(id).lines]))
  const session = buildSession({
    repertoire: state.repertoire, linesByOpening, progress: state.progress, now,
    newPerDay: state.settings.newPerDay, introducedToday: introducedTodayCount(state.progress, state.repertoire, now),
  })
  const rushPool = rushPositions([...loaded.values()].map(({ opening, lines }) => ({
    openingId: opening.id, side: opening.side, lines, progress: state.progress[opening.id] || {},
  })), now)
  const sides = [...new Set(state.repertoire.map((id) => loaded.get(id)?.opening.side).filter(Boolean))]
  const puzzleAttempts = await ctx.getPuzzleAttempts()
  const path = await ctx.getChallengePath(puzzleAttempts)
  const insights = recentInsights({ puzzles: puzzleAttempts, activity: game.events, now })
  const mastery = await ctx.getMastery(puzzleAttempts)
  let justOpenedChest = false
  game.ensureQuests({ dueCount: session.dueCount, newAvailable: session.newCount, repertoireSides: sides, rushReady: rushPool.length >= RUSH.minPositions, challengeFocus: path.focus.id, personalDue: path.personalDue })

  // Répertoire de départ (D7), calculé seulement pour un répertoire vide.
  let starter = []
  if (!state.repertoire.length) {
    const diffs = new Map()
    await Promise.all(selection.map(async (o) => diffs.set(o.id, difficultyOf((await getCachedLines({ ...o, tier: 'selection' })).header))))
    starter = starterRepertoire(selection, {
      difficultyOf: (id) => diffs.get(id),
      scoreOf: (id) => bandStatsFor(stats, id, 'selection', band)?.scoreLow ?? null,
    })
  }

  function heroCard(g) {
    const { level, streak, today } = g
    const goalPct = Math.min(100, Math.round((today.xp / today.goal) * 100))
    const streakNote = streak.todayActive
      ? (streak.freezes ? t('today.freeze', { count: streak.freezes }) : t('today.streakSafe'))
      : streak.current ? t('today.streakPlay') : t('today.streakStart')
    return `
      <section class="card hero" aria-label="${t('today.myLevel')}">
        <div class="hero-level">
          <span class="level-badge mono" aria-hidden="true">${level.level}</span>
          <div>
            <p class="hero-title">${levelTitle(level.level)} <small>${t('today.level', { level: level.level })}</small></p>
            <p class="hero-sub mono">${t('today.toNext', { into: NUM.format(level.into), span: NUM.format(level.span), next: level.level + 1 })}</p>
          </div>
        </div>
        <progress class="xpbar" value="${level.into}" max="${level.span}"></progress>
        ${level.nextTitle ? `<p class="hero-next">${t('today.nextTitle', { title: levelTitle(level.nextTitle.level), level: level.nextTitle.level })}</p>` : ''}
        <div class="hero-stats">
          <div class="stat streak${streak.todayActive ? ' on' : streak.atRisk ? ' risk' : ''}">
            ${flameSvg()}
            <div><b class="mono">${streak.current}</b> ${t(streak.current === 1 ? 'today.streakOne' : 'today.streakMany')}<small>${streakNote}</small></div>
          </div>
          <div class="stat goal${today.goalMet ? ' met' : ''}">
            <span class="ring" style="--p:${goalPct}" aria-hidden="true"></span>
            <div><b class="mono">${today.xp}</b> / ${today.goal} XP<small>${t('today.goal')} « ${t(`goal.${GOALS[today.goal] ? today.goal : 60}`)} »${today.goalMet ? t('today.goalMet') : ''}</small></div>
          </div>
          ${g.boost ? `<div class="stat boost"><b class="mono">×2</b><div>${t('today.boost')}<small>${t('today.until', { time: new Date(g.boost.until).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</small></div></div>` : ''}
        </div>
      </section>
    `
  }

  function sessionCard() {
    if (!state.repertoire.length) {
      return `
        <section class="card session-card starter">
          <h2>${t('today.starter')}</h2>
          <button type="button" class="cta primary btn-starter"${starter.length ? '' : ' disabled'}>${t('today.starterStart', { count: starter.length })}</button>
          <p class="muted">${t('today.starterDesc')}</p>
          <a class="starter-rating" href="#/settings">${t('today.starterRating')}</a>
          <ul class="starter-list">
            ${starter.map((o) => `
              <li><a href="#/opening/${o.id}"><b>${escapeHtml(openingName(o))}</b><small>${sideName(o.side)} · <span class="mono">${movesText(o.moves)}</span></small></a></li>
            `).join('')}
          </ul>
        </section>
      `
    }
    if (session.total) {
      const minutes = Math.max(1, Math.round((session.total * SECONDS_PER_LINE) / 60))
      return `
        <section class="card session-card">
          <h2>${t('today.session')}</h2>
          <p class="session-counts">${t('today.sessionCounts', { due: session.dueCount, fresh: session.newCount, minutes })}</p>
          <a class="cta primary cta-start" href="#/session/go">${t('today.start')}</a>
        </section>
      `
    }
    return `
      <section class="card session-card done">
        <h2>${t('today.repertoireReady')}</h2>
        <p class="muted">${t('today.repertoireReadyDesc')}</p>
        <a class="cta" href="#/library/repertoire">${t('today.myRepertoire')}</a>
      </section>
    `
  }

  function questsCard(g) {
    const quests = g.today.quests
    const done = quests.filter((q) => q.done).length
    const chest = g.today.chest
    const worked = [...mastery.practiced].sort((a, b) => b.lastAt - a.lastAt)[0]
    const workedName = worked?.kind === 'theme' ? t(`theme.${worked.id}`) : worked ? openingName(resolveOpening(worked.id, { selection, openings }) || { name: worked.id }) : ''
    const cardNote = worked ? `${t('mastery.chestCard', { name: escapeHtml(workedName), level: worked.level })} · ${worked.next ? t(`mastery.next.${worked.next.kind}`, worked.next) : t('mastery.max')}` : t('mastery.chestNone')
    let chestHtml
    if (chest.opened) chestHtml = `<div class="chest open${justOpenedChest ? ' chest-reveal' : ''}"${justOpenedChest ? ' role="status"' : ''}><span class="chest-icon" aria-hidden="true"></span><p><b>${t(justOpenedChest ? 'mastery.chestReveal' : 'today.chestOpen')}</b> ${escapeHtml(rewardText(chest.opened))}<small>${cardNote}</small></p></div>`
    else if (chest.available) chestHtml = `<button type="button" class="chest ready btn-chest"><span class="chest-icon" aria-hidden="true"></span><span><b>${t('today.chestReady')}</b> ${t('today.surprise')}</span></button>`
    else chestHtml = `<div class="chest locked"><span class="chest-icon" aria-hidden="true"></span><p><b>${t('today.chestLocked')}</b> ${t('today.chestLockedDesc')}</p></div>`
    return `
      <section class="card quests">
        <header class="card-head"><h2>${t('today.quests')}</h2><span class="muted mono">${done}/${quests.length}</span></header>
        <ul class="quest-list">
          ${quests.map((q) => `
            <li class="quest${q.done ? ' done' : ''}" data-level="${q.level}">
              <span class="quest-check" aria-hidden="true"></span>
              <div class="quest-body">
                <p>${escapeHtml(questText(q))}</p>
                <div class="qbar" aria-hidden="true"><i style="width:${Math.round((q.progress / q.target) * 100)}%"></i></div>
              </div>
              <span class="quest-count mono">${q.progress}/${q.target}</span>
              <span class="quest-xp mono">+${q.xp}</span>
            </li>
          `).join('')}
        </ul>
        ${chestHtml}
      </section>
    `
  }

  function focusCard(g) {
    const nameOf = (group) => {
      if (group.kind === 'theme') return t(`theme.${group.id}`)
      const opening = resolveOpening(group.id, { selection, openings })
      return opening ? openingName(opening) : group.id
    }
    const hrefOf = (group) => group.kind === 'theme'
      ? `#/exercises/theme/${encodeURIComponent(group.id)}`
      : `#/train/${encodeURIComponent(group.id)}`
    const priorities = insights.weaknesses.slice(0, 3)
    const firstCard = priorities.length ? mastery.byKey.get(`${priorities[0].kind}\0${priorities[0].id}`) : null
    const proof = path.next.kind === 'puzzle' ? t('path.puzzles') : path.next.kind === 'memory' ? t('path.recall') : t('path.games')
    return `
      <section class="card today-focus" aria-label="${t('today.focus')}">
        <div class="focus-stage">
          <span class="focus-symbol" aria-hidden="true">♟</span>
          <div>
            <p class="eyebrow">${t('today.currentStage')}</p>
            <h2>${t(`path.stage.${path.focus.id}`)}</h2>
            <p>${t('today.xpLevel', { level: g.level.level })} · ${t('today.nextStep', { proof })}</p>
          </div>
        </div>
        <div class="focus-work">
          <p class="eyebrow">${t('today.priority')}</p>
          ${priorities.length ? `
            <ol class="focus-list">${priorities.map((group, i) => `
              <li${i === 0 ? ' class="first"' : ''}>
                <span class="focus-rank mono">${i + 1}</span>
                <a href="${hrefOf(group)}">${escapeHtml(nameOf(group))}</a>
                <span class="focus-rate mono">${t('today.cleanAttempts', { rate: formatPct(group.clean / group.count), clean: group.clean, count: group.count })}</span>
              </li>`).join('')}</ol>
            <a class="cta primary focus-action" href="${hrefOf(priorities[0])}">${t('insights.action')} ↗</a>
            ${firstCard ? `<a class="focus-mastery" href="#/progress/cards"><span aria-hidden="true">♞</span> ${t(`mastery.level.${firstCard.level}`)} · ${firstCard.next ? t(`mastery.next.${firstCard.next.kind}`, firstCard.next) : t('mastery.max')} ↗</a>` : ''}
          ` : `
            <p class="focus-empty">${t(insights.eligible.length ? 'today.noWeakness' : 'today.noPriority', { count: insights.count })}</p>
            <a class="cta primary focus-action" href="${path.next.href}">${t(`path.action.${path.next.kind}`)} ↗</a>
          `}
          <div class="focus-foot"><span>${t('insights.period')} · ${t('insights.local')}</span><a class="focus-details" href="#/progress/stats">${t('today.seeInsights')} ↗</a></div>
        </div>
      </section>
    `
  }

  function rushCard(g) {
    const ready = rushPool.length >= RUSH.minPositions
    return `
      <section class="card rush-card">
        <header class="card-head"><h2>XChess Rush</h2><span class="muted">${t('today.rushLives', { minutes: RUSH.seconds / 60, lives: RUSH.lives })}</span></header>
        <p class="muted">${t('today.rushDesc')}</p>
        <p class="rush-records"><span>${t('today.record')} <b class="mono">${g.counters.rushBest}</b></span><span>${t('today')} <b class="mono">${g.today.rushMax}</b></span><span><b class="mono">${NUM.format(rushPool.length)}</b> ${t('today.positions')}</span></p>
        ${ready
          ? `<a class="cta primary" href="#/rush">${t('today.launchRush')}</a>`
          : `<p class="locked-note">${t('today.rushLocked', { count: rushPool.length, needed: RUSH.minPositions })}</p>`}
      </section>
    `
  }

  function memoryCard() {
    const rows = state.repertoire
      .map((id) => loaded.get(id))
      .filter(Boolean)
      .map(({ opening, lines }) => ({ opening, m: openingMemory(lines, state.progress[opening.id] || {}, now) }))
      .filter((r) => r.m)
      .sort((a, b) => a.m.memory - b.m.memory)
    if (!rows.length) return ''
    const fading = rows.filter((r) => r.m.memory < 0.85).slice(0, 4)
    return `
      <section class="card memory">
        <header class="card-head"><h2>${t('today.refresh')}</h2><span class="muted">${t('today.memoryEstimated')}</span></header>
        ${fading.length ? `<ul class="memory-list">
          ${fading.map(({ opening, m }) => {
            const tone = m.memory < 0.5 ? 'bad' : m.memory < 0.7 ? 'warn' : 'good'
            return `
              <li>
                <a href="#/train/${opening.id}" class="memory-row">
                  <span class="memory-name">${escapeHtml(openingName(opening))}<small>${t('today.linesPlayed', { played: m.played, total: m.total })}</small></span>
                  <span class="gauge" data-tone="${tone}" aria-hidden="true"><i style="width:${Math.round(m.memory * 100)}%"></i></span>
                  <b class="mono">${formatPct(m.memory)}</b>
                </a>
              </li>`
          }).join('')}
        </ul>` : `<p class="muted">${t('today.memoryFresh')}</p>`}
      </section>
    `
  }

  function discoveryCard(g) {
    const id = game.pickOfDay()
    const o = id && resolveOpening(id, { selection, openings })
    if (!o) return ''
    const meta = catalogMeta(id)
    const score = stats.catalog?.[id]?.scoreLow
    const played = g.today.openings.has(id)
    return `
      <section class="card discovery">
        <header class="card-head"><h2>${t('today.discovery')}</h2><span class="badge-x2 mono">XP ×2</span></header>
        <p class="discovery-name">${escapeHtml(openingName(o))}</p>
        <p class="muted">${o.eco} · ${sideName(o.side)}${meta ? ` · ${NUM.format(meta.lines)} ${t(meta.lines === 1 ? 'today.line' : 'today.lines')} ${dots(meta.difficulty, t)}` : ''}${score != null ? ` · ${t('today.beginnerScore', { score: formatPct(score) })}` : ''}</p>
        <p class="mono discovery-moves">${movesText(o.moves)}</p>
        ${played ? `<p class="good-note">${t('today.discoveryPlayed')}</p>` : ''}
        <a class="cta" href="#/opening/${o.id}">${t('today.discover')}</a>
      </section>
    `
  }

  function render() {
    const g = game.derive()
    grid.innerHTML = `
      ${focusCard(g)}
      <div class="today-main">${sessionCard()}${heroCard(g)}${questsCard(g)}</div>
      <div class="today-side">${rushCard(g)}${memoryCard()}${discoveryCard(g)}</div>
    `
    grid.querySelector('.btn-starter')?.addEventListener('click', async () => {
      await saveRepertoire(starter.map((o) => o.id))
      navigate('#/session/go')
    })
    grid.querySelector('.btn-chest')?.addEventListener('click', () => {
      if (!game.openChest()) return
      justOpenedChest = true
      render()
    })
  }
  render()

  return { destroy() {} }
}
