// Present the next playable activity and the current learning phase.
import { selection, openings, stats } from '../data.js'
import { buildSession, starterRepertoire } from '../core/session.js'
import { introducedTodayCount } from '../core/stats.js'
import { rushPositions, RUSH, TITLES } from '../core/game.js'
import { resolveLocale } from '../i18n.js'
import { homeVisualMessages } from '../i18n-home-visual.js'
import '../visual-home.css'
import { resolveOpening, getCachedLines, difficultyOf, bandStatsFor, escapeHtml } from './shared.js'
import { hasPendingSession } from './session.js'

function activityCard({ kind, label, title, description = '', action, href, primary = false }) {
  return `
    <article class="home-activity home-activity-${kind}${primary ? ' home-activity-primary' : ''}">
      <div class="home-activity-copy">
        <p class="home-activity-label">${escapeHtml(label)}</p>
        <h2>${escapeHtml(title)}</h2>
        <p class="home-activity-description"${description ? '' : ' hidden'}>${escapeHtml(description)}</p>
        <a class="${primary ? 'cta primary' : 'home-activity-link'}" href="${href}">
          <span>${escapeHtml(action)}</span><span aria-hidden="true">${primary ? '→' : '›'}</span>
        </a>
        ${primary ? '<a class="home-repertoire-link" href="#/library/repertoire" hidden></a>' : ''}
      </div>
    </article>`
}

export async function mount(host, ctx) {
  const { state, band, game, saveRepertoire, navigate, setActions, t } = ctx
  const locale = resolveLocale(state.settings.locale)
  const words = homeVisualMessages[locale]
  const openingName = (opening) => escapeHtml(locale === 'fr' ? opening.name : opening.lichessName || opening.name)
  const firstOpening = !state.repertoire.length && !Object.values(state.progress).some((lines) => Object.keys(lines).length)
  const welcome = {
    label: words.start, title: words.italian, description: words.guided,
    action: words.firstMove, href: '#/first-opening',
  }
  const preparing = {
    label: '', title: t('today.session'), description: t('today.preparing'),
    action: t('today.start'), href: '#/session',
  }
  const exercises = {
    kind: 'tactics', label: words.quick, title: t('mode.mate1'),
    action: words.tryMate, href: '#/exercises/mate1',
  }
  const library = {
    kind: 'openings', label: words.yourPace, title: words.chooseOpening, description: words.openingHint,
    action: words.selection, href: '#/library/selection',
  }

  setActions({})
  host.innerHTML = `
    <div class="today home-visual">
      <h1 class="home-heading">${escapeHtml(words.home)}</h1>
      <div class="home-activities">
        ${activityCard({ kind: 'opening', primary: true, ...(firstOpening ? welcome : preparing) })}
        ${activityCard(exercises)}
        ${activityCard(library)}
      </div>
      <section class="home-progress" aria-labelledby="home-progress-title">
        <div class="home-section-head">
          <h2 id="home-progress-title">${escapeHtml(words.progress)}</h2>
          <a href="#/progress">${escapeHtml(t('coach.openProgress'))} <span aria-hidden="true">›</span></a>
        </div>
        <div class="home-progress-grid">
          <a class="home-level" href="#/progress/trophies"></a>
          <div class="home-path">
            <h3>${escapeHtml(firstOpening ? words.firstPath : words.path)}</h3>
            <ol class="home-steps">
              ${['discover', 'recall', 'review'].map((step, i) => `
                <li data-step="${step}"><span class="home-step-number" aria-hidden="true">${i + 1}</span>
                  <div><strong>${escapeHtml(t(`phase.${step}`))}</strong><small>${escapeHtml(words[step])}</small></div>
                </li>`).join('')}
            </ol>
          </div>
        </div>
      </section>
      <div class="today-content">${firstOpening ? '' : `<p class="empty" role="status">${t('today.preparing')}</p>`}</div>
    </div>
  `
  const content = host.querySelector('.today-content')
  const levelCard = host.querySelector('.home-level')

  function renderLevel({ level, today }) {
    const rank = TITLES.findLast(([threshold]) => level.level >= threshold)[0]
    const name = t('today.level', { level: level.level }).replace(/^./u, (char) => char.toLocaleUpperCase(locale))
    levelCard.innerHTML = `
      <div class="home-level-heading">
        <span class="home-level-emblem" data-rank="${rank}" aria-hidden="true"><span>◇</span></span>
        <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(t(`title.${rank}`))}</small></span>
        <span class="home-level-chevron" aria-hidden="true">›</span>
      </div>
      <progress class="xpbar" value="${level.into}" max="${level.span}" aria-label="${escapeHtml(t('today.myLevel'))}"></progress>
      <div class="home-level-meta">
        <span>${level.into} / ${level.span} XP</span>
        <span>${escapeHtml(t('header.goal', { xp: today.xp, goal: today.goal }))}</span>
      </div>
    `
  }
  renderLevel(game.derive())
  if (firstOpening) host.querySelector('[data-step="discover"]').setAttribute('aria-current', 'step')

  const now = Date.now()
  const repertoire = state.repertoire
  const needQuests = !game.derive().today.questsGenerated
  const ids = [...new Set(needQuests ? [...repertoire, ...Object.keys(state.progress)] : repertoire)]
  const openingsById = new Map((await Promise.all(ids.map(async (id) => {
    const opening = resolveOpening(id, { selection, openings })
    return opening && [id, { side: opening.side, ...await getCachedLines(opening) }]
  }))).filter(Boolean))
  const session = buildSession({
    repertoire, linesByOpening: Object.fromEntries(repertoire.map((id) => [id, openingsById.get(id)?.lines])),
    progress: state.progress, now, newPerDay: state.settings.newPerDay,
    introducedToday: introducedTodayCount(state.progress, repertoire, now),
  })
  const resume = session.total > 0 && await hasPendingSession()

  if (needQuests && host.isConnected) {
    const path = await ctx.getChallengePath()
    const rushPool = rushPositions([...openingsById].map(([openingId, { side, lines }]) => ({
      openingId, side, lines, progress: state.progress[openingId] || {},
    })), now)
    if (host.isConnected) game.ensureQuests({
      dueCount: session.dueCount, newAvailable: session.newCount,
      repertoireSides: [...new Set(repertoire.map((id) => openingsById.get(id)?.side).filter(Boolean))],
      rushReady: rushPool.length >= RUSH.minPositions, challengeFocus: path.focus.id, personalDue: path.personalDue,
    })
  }

  if (!host.isConnected) return { destroy() {} }

  if (!firstOpening) {
    const card = host.querySelector('.home-activity-primary')
    const actionLink = card.querySelector('.cta')
    const repertoireLink = card.querySelector('.home-repertoire-link')
    const counts = [
      session.dueCount ? t('today.dueShort', { count: session.dueCount }) : '',
      session.newCount ? t('today.freshShort', { count: session.newCount }) : '',
      t('today.minutesShort', { count: session.total }),
    ].filter(Boolean).join(' · ')
    const [label, title, description, href, action] = session.total
      ? ['', t('today.session'), counts, '#/session/go', resume ? t('coach.resume') : t('today.start')]
      : repertoire.length
        ? [words.yourPace, t('today.repertoireReady'), t('today.repertoireReadyDesc'), '#/exercises', t('today.tryPuzzle')]
        : ['', t('today.starter'), t('today.starterDesc'), '#/library', t('nav.library')]

    card.querySelector('.home-activity-label').textContent = label
    card.querySelector('h2').textContent = title
    const descriptionEl = card.querySelector('.home-activity-description')
    descriptionEl.textContent = resume ? `${description} · ${t('coach.resumeNote')}` : description
    descriptionEl.hidden = false
    actionLink.href = href
    actionLink.querySelector('span').textContent = action

    if (!session.total && repertoire.length) {
      repertoireLink.textContent = t('today.myRepertoire')
      repertoireLink.hidden = false
    }
    if (session.queue.length) {
      const currentPhase = session.queue[0].isNew ? 'discover' : 'review'
      host.querySelector(`[data-step="${currentPhase}"]`).setAttribute('aria-current', 'step')
    }
  }

  const discoveryId = game.pickOfDay()
  const discovery = discoveryId && resolveOpening(discoveryId, { selection, openings })
  content.innerHTML = `
    <div class="today-options">
      ${!repertoire.length ? `<details class="today-details today-starter">
        <summary>${t('today.starter')}</summary>
        <div class="today-details-body" aria-live="polite"></div>
      </details>` : ''}
      <details class="today-details today-challenges">
        <summary><span>${t('today.quests')}</span><span class="today-challenge-count"></span></summary>
        <div class="today-details-body"></div>
      </details>
      ${discovery ? `<a class="today-discovery" href="#/opening/${encodeURIComponent(discovery.id)}">
        <span>${t('today.discovery')}<b>${openingName(discovery)}</b></span><span aria-hidden="true">›</span>
      </a>` : ''}
    </div>
  `

  function renderChallenges(claimed = false) {
    const { today, streak, boost } = game.derive()
    const summary = content.querySelector('.today-challenge-count')
    const details = content.querySelector('.today-challenges .today-details-body')
    const done = today.quests.filter((quest) => quest.done).length
    summary.textContent = today.chest.available ? t('today.chestReady') : `${done}/${today.quests.length}`
    const reward = today.chest.opened
    const rewardText = reward?.kind === 'freeze' ? t('today.rewardFreeze')
      : reward?.kind === 'boost' ? t('today.rewardBoost', { minutes: reward.minutes || 15 })
        : reward ? `+${reward.xp} XP` : ''
    details.innerHTML = `
      <ul class="quest-list">${today.quests.map((quest) => {
        const o = quest.openingId && resolveOpening(quest.openingId, { selection, openings })
        const description = t(`quest.${quest.kind}`, { count: quest.target, side: quest.side ? t(`side.${quest.side}`) : '', opening: o ? `: ${openingName(o)}` : '' })
        return `<li class="today-quest"><span>${description}</span><b class="mono">${quest.progress}/${quest.target}</b></li>`
      }).join('')}</ul>
      ${reward ? `<p class="today-reward" tabindex="-1">${t('today.chestOpen')} · ${rewardText}</p>` : today.chest.available
        ? `<button type="button" class="cta btn-chest">${t('today.chestReady')}</button>`
        : `<p class="muted">${t('today.chestLockedDesc')}</p>`}
      ${streak.freezes ? `<p class="muted">${t('today.freeze', { count: streak.freezes })}</p>` : ''}
      ${boost ? `<p class="muted">${t('today.boost')} · ${t('today.until', { time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(boost.until) })}</p>` : ''}
    `
    details.querySelector('.btn-chest')?.addEventListener('click', () => {
      if (game.openChest()) renderChallenges(true)
    })
    if (claimed) details.querySelector('.today-reward')?.focus()
  }

  const starterDetails = content.querySelector('.today-starter')
  if (starterDetails) {
    let loading = false
    starterDetails.addEventListener('toggle', async () => {
      if (!starterDetails.open || loading) return
      loading = true
      const body = starterDetails.querySelector('.today-details-body')
      body.textContent = t('today.preparing')
      const difficulties = new Map(await Promise.all(selection.map(async (o) => [
        o.id, difficultyOf((await getCachedLines({ ...o, tier: 'selection' })).header),
      ])))
      if (!starterDetails.isConnected) return
      const starter = starterRepertoire(selection, {
        difficultyOf: (id) => difficulties.get(id),
        scoreOf: (id) => bandStatsFor(stats, id, 'selection', band)?.scoreLow ?? null,
      })
      body.innerHTML = `
        <p class="muted">${t('today.starterDesc')}</p>
        <ul class="starter-list">${starter.map((o) => `<li><a href="#/opening/${o.id}">${openingName(o)} <small>${t(`side.${o.side}`)}</small></a></li>`).join('')}</ul>
        <a class="today-secondary-link" href="#/settings">${t('today.starterRating')}</a>
        <button class="cta btn-starter" type="button"${starter.length ? '' : ' disabled'}>${t('today.starterStart', { count: starter.length })}</button>
      `
      const start = body.querySelector('.btn-starter')
      start.addEventListener('click', async () => {
        start.disabled = true
        const saved = await saveRepertoire(starter.map((o) => o.id))
        if (!start.isConnected) return
        if (saved) navigate('#/session/go')
        else start.disabled = false
      })
    })
  }

  renderChallenges()
  const unsubscribe = game.subscribe(renderLevel)
  return { destroy: unsubscribe }
}
