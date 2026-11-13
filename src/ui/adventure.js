import season from '../../catalog/adventure-season-1.json'
import { mountEncounter } from './adventure-encounter.js'
import { textOf, portrait } from './adventure-shared.js'
import { escapeHtml } from './shared.js'
import { mountCompanion } from './companion.js'

export async function mount(host, ctx) {
  const progress = ctx.getAdventure()
  const id = ctx.params?.id
  if (id) {
    const encounter = season.encounters.find((item) => item.id === id)
    if (!encounter || !progress.available.includes(id)) {
      host.innerHTML = `<p>${ctx.t('adventure.locked')}</p><a href="#/adventure">${ctx.t('adventure.back')}</a>`
      return { destroy() {} }
    }
    return mountEncounter(host, ctx, encounter)
  }
  const { t } = ctx
  const locale = ctx.state.settings.locale
  host.classList.add('adventure-map')
  host.innerHTML = `<p class="eyebrow"><a href="#/">${t('today')}</a></p><header class="adventure-heading"><div><h1>${t('adventure.title')}</h1><p>${t('adventure.summary')}</p></div><div class="adventure-guide"></div></header>
    <div class="adventure-chapters">${season.chapters.map((chapter, index) => {
      const complete = progress.completedChapters.includes(chapter.id)
      return `<section class="adventure-chapter" data-complete="${complete}"><header><p class="eyebrow">${t('adventure.chapter', { number: index + 1 })}</p><h2>${escapeHtml(textOf(chapter.title, locale))}</h2><p>${t('adventure.progress', { won: chapter.encounters.filter((key) => progress.encounters[key].won).length })}</p></header><div class="adventure-encounters">${chapter.encounters.map((key, position) => {
        const encounter = season.encounters.find((item) => item.id === key)
        const record = progress.encounters[key]
        const available = progress.available.includes(key)
        const content = `${portrait(encounter.opponent.portrait, encounter.opponent.name)}<div><small>${escapeHtml(encounter.opponent.name)}</small><h3>${escapeHtml(textOf(encounter.title, locale))}</h3><p>${record.won ? t(record.unaided ? 'adventure.unaided' : 'adventure.assisted') : available ? t(Object.keys(record.attempts).length ? 'adventure.resume' : 'adventure.enter') : t(position === 2 && (index === 0 || progress.completedChapters.includes(season.chapters[index - 1].id)) ? 'adventure.finalLocked' : 'adventure.locked')}</p></div>`
        return available ? `<a href="#/adventure/${key}" class="adventure-encounter" data-won="${record.won}">${content}</a>` : `<article class="adventure-encounter locked" aria-disabled="true">${content}</article>`
      }).join('')}</div><p class="adventure-reward">${complete ? t('adventure.earned') + ' · ' : ''}${t('adventure.reward', { rabbit: t(`skin.${chapter.reward.rabbit}`), board: t(`board.${chapter.reward.board}`) })}</p>${complete ? `<details class="adventure-passage"><summary>${t('adventure.passage')}</summary><p>${escapeHtml(textOf(chapter.passage, locale))}</p><a href="#/collection">${t('collection.open')}</a></details>` : ''}</section>`
    }).join('')}</div>`
  const companion = mountCompanion(host.querySelector('.adventure-guide'), ctx, { collection: await ctx.getCollection(), preview: false })
  ctx.setActions({})
  return { destroy() { companion.destroy() } }
}
