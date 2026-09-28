// Écran d'accueil : les 3 étages du catalogue (spec section 3) en onglets, et un tableau condensé
// (spec V2, L0 point 9) : 1 rangée = 1 ligne, colonnes alignées, en-têtes cliquables pour trier, camp
// en contrôle segmenté. Le catalogue complet (3 815 entrées) reste fluide grâce à la liste virtualisée
// de shared.js : seules les rangées visibles sont dans le DOM.
import { selection, openings, stats, catalogMeta } from '../data.js'
import { statusOf, localDateStr, DAY } from '../core/srs.js'
import {
  bandStatsFor,
  normalizeText,
  debounce,
  createVirtualList,
  getCachedLines,
  difficultyOf,
  escapeHtml,
  ELO_SOURCE_LABEL,
} from './shared.js'

const ROW_HEIGHT = 44
// Téléphone : rangée sur 2 lignes (nom, puis difficulté, progression, score), hauteur fixe elle aussi
// pour la liste virtuelle. Même seuil que la mise en page mobile de src/style.css.
const ROW_HEIGHT_MOBILE = 64
const MOBILE_QUERY = '(max-width: 640px)'
const TABS = ['selection', 'catalog', 'repertoire']
// Colonnes triables : `dir` = sens du 1er clic ; un 2e clic inverse.
const COLUMNS = [
  { id: 'name', label: 'Ouverture', dir: 1 },
  { id: 'eco', label: 'ECO', dir: 1 },
  { id: 'side', label: 'Camp', dir: 1 },
  { id: 'family', label: 'Famille', dir: 1 },
  { id: 'difficulty', label: 'Difficulté', dir: 1, title: 'Learning load' },
  { id: 'score', label: 'Score', dir: -1, title: 'Score prudent dans ma tranche', extra: { id: 'games', label: 'Parties', dir: -1 } },
  { id: 'progress', label: 'Progression', dir: -1, title: 'Lignes maîtrisées sur le total' },
  { id: 'due', label: 'Échéance', dir: 1, title: 'Prochaine révision (répertoire)' },
]

// Échéance d'une ouverture : « aujourd'hui » si une ligne est due ou neuve (dans mon répertoire),
// sinon la plus proche échéance en jours calendaires ; null hors répertoire et sans progression.
export function dueOf(lines, progress, inRepertoire, now = Date.now()) {
  const played = lines.filter((l) => progress[l.id])
  if (!inRepertoire && !played.length) return null
  if (inRepertoire && played.length < lines.length) return { rank: 0, label: "aujourd'hui" }
  if (!played.length) return null
  const next = Math.min(...played.map((l) => progress[l.id].due))
  const days = Math.round((new Date(localDateStr(next)) - new Date(localDateStr(now))) / DAY)
  if (days <= 0) return { rank: 0, label: "aujourd'hui" }
  return { rank: days, label: days === 1 ? 'demain' : `dans ${days} j` }
}

function dots(d, t) {
  if (!d) return '<span class="lib-muted">-</span>'
  return `<span class="lib-dots" aria-label="${t('library.dots', { value: d })}">${'●'.repeat(d)}<span class="lib-dots-off">${'○'.repeat(5 - d)}</span></span>`
}
function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export async function mount(host, ctx) {
  const { params, state, band, navigate, saveSettings, setActions, t } = ctx
  const entryName = (entry) => state.settings.locale === 'fr' ? entry.name : entry.lichessName || entry.name
  const formatPercent = (value) => value == null ? '-' : new Intl.NumberFormat(state.settings.locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  const formatGames = (value) => value == null ? '-' : new Intl.NumberFormat(state.settings.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
  const dueLabel = (due) => !due ? null : due.rank === 0 ? t('library.today') :
    due.rank === 1 ? t('library.tomorrow') : t('library.inDays', { days: due.rank })
  host.innerHTML = `
    <div class="lib-page">
      <header class="lib-top">
        <h1>${t('library.title')}</h1>
        <div class="tabs lib-tabs" role="tablist" aria-label="${t('library.catalogue')}">
          ${TABS.map((tab) => `<button type="button" role="tab" data-tab="${tab}" aria-selected="false">${t(`library.tab.${tab}`)} (${tab === 'selection' ? selection.length : tab === 'catalog' ? openings.length : state.repertoire.length})</button>`).join('')}
        </div>
        <details class="lib-rating-control">
          <summary>${t('library.myRating', { elo: state.settings.elo, source: ELO_SOURCE_LABEL[state.settings.eloSource], band: t(`band.${band}`) })}</summary>
          <form class="lib-rating-form">
            <label>${t('settings.elo')}<input class="lib-elo" type="number" min="0" max="3000" step="1" value="${state.settings.elo}" required></label>
            <label>${t('settings.source')}<select class="lib-source">${Object.entries(ELO_SOURCE_LABEL).map(([key, label]) => `<option value="${key}" ${key === state.settings.eloSource ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <button type="submit" class="primary">${t('library.applyRating')}</button>
          </form>
        </details>
      </header>
      <div class="lib-tools">
        <input type="search" class="lib-search" placeholder="${t('library.searchShort')}" aria-label="${t('library.searchLabel')}" />
        <div class="lib-difficulty" role="group" aria-label="${t('library.difficultyHint')}">
          <span>${t('library.difficulty')}</span>
          ${['all', 1, 2, 3, 4, 5].map((value) => `<button type="button" data-difficulty="${value}" aria-pressed="${value === 'all'}">${value === 'all' ? t('library.all') : value}</button>`).join('')}
        </div>
        <details class="lib-more"><summary>${t('library.filters')}</summary>
          <div class="lib-more-body">
            <div class="seg f-side" role="radiogroup" aria-label="${t('library.side')}">
              <button type="button" role="radio" data-side="all" aria-checked="true">${t('library.all')}</button>
              <button type="button" role="radio" data-side="white" aria-checked="false">${t('side.white')}</button>
              <button type="button" role="radio" data-side="black" aria-checked="false">${t('side.black')}</button>
            </div>
            <select class="f-family" aria-label="${t('library.family')}"><option value="all">${t('library.allFamilies')}</option>${['classique', 'gambit', 'exotique'].map((key) => `<option value="${key}">${t(`family.${key}`)}</option>`).join('')}</select>
          </div>
        </details>
        <p class="lib-count"></p>
      </div>
      <div class="lib-table">
        <div class="lib-head">
          ${COLUMNS.map((c) => `
            <span class="lib-cell lib-col-${c.id}">
              <button type="button" class="lib-sort" data-sort="${c.id}"${c.title ? ` title="${t(`library.${c.id}Hint`)}"` : ''}>${c.id === 'eco' ? 'ECO' : c.id === 'score' ? 'Score' : c.id === 'name' ? t('library.opening') : t(`library.${c.id}`)}</button>${c.extra ? ` · <button type="button" class="lib-sort" data-sort="${c.extra.id}">${t('library.games')}</button>` : ''}
            </span>`).join('')}
        </div>
        <div class="lib-list vlist"></div>
      </div>
    </div>
  `
  const searchEl = host.querySelector('.lib-search')
  const sideButtons = [...host.querySelectorAll('.f-side button')]
  const familyEl = host.querySelector('.f-family')
  const diffButtons = [...host.querySelectorAll('[data-difficulty]')]
  const countEl = host.querySelector('.lib-count')
  const listHost = host.querySelector('.lib-list')
  const sortButtons = [...host.querySelectorAll('.lib-sort')]

  let tab = params.tab && TABS.includes(params.tab) ? params.tab : 'selection'
  let side = 'all'
  let difficulty = 'all'
  let sort = { id: 'score', dir: -1 }
  let visible = []
  // id -> { total, masteredCount, pct, difficulty, due } | null, une fois l'arbre chargé.
  const metaCache = new Map()

  function entriesForTab() {
    if (tab === 'selection') return selection.map((o) => ({ ...o, tier: 'selection' }))
    if (tab === 'repertoire') {
      return state.repertoire
        .map((id) => selection.find((o) => o.id === id) || openings.find((o) => o.id === id))
        .filter(Boolean)
        .map((o) => ({ ...o, tier: selection.some((s) => s.id === o.id) ? 'selection' : 'catalog' }))
    }
    return openings.map((o) => ({ ...o, tier: 'catalog' }))
  }

  function matchesSearch(entry, q) {
    if (!q) return true
    const hay = normalizeText(`${entry.name} ${entry.lichessName ?? ''} ${entry.eco ?? ''} ${entry.moves.join(' ')}`)
    return hay.includes(q)
  }
  function matchesFilters(entry) {
    if (side !== 'all' && entry.side !== side) return false
    if (familyEl.value !== 'all' && entry.family !== familyEl.value) return false
    if (difficulty !== 'all' && String(metaCache.get(entry.id)?.difficulty) !== difficulty) return false
    return true
  }
  // Valeur de tri : les entrées sans valeur finissent toujours en bas, quel que soit le sens.
  function sortValue(entry) {
    const meta = metaCache.get(entry.id)
    const bs = bandStatsFor(stats, entry.id, entry.tier, band)
    switch (sort.id) {
      case 'name': return normalizeText(entryName(entry))
      case 'eco': return entry.eco ?? null
      case 'side': return entry.side
      case 'family': return entry.family ?? null
      case 'difficulty': return meta?.difficulty ?? null
      case 'games': return bs?.games ?? null
      case 'progress': return meta ? meta.pct : null
      case 'due': return meta?.due?.rank ?? null
      default: return bs?.scoreLow ?? null
    }
  }
  function compare(a, b) {
    const va = sortValue(a)
    const vb = sortValue(b)
    if (va == null || vb == null) return (va == null) - (vb == null)
    if (va < vb) return -sort.dir
    if (va > vb) return sort.dir
    return 0
  }

  function recompute() {
    const q = normalizeText(searchEl.value.trim())
    visible = entriesForTab().filter((e) => matchesSearch(e, q) && matchesFilters(e)).sort(compare)
    countEl.textContent = tab === 'catalog'
      ? t('library.countOf', { count: visible.length, total: openings.length })
      : t('library.count', { count: visible.length })
    for (const b of sortButtons) {
      const active = b.dataset.sort === sort.id
      b.dataset.active = String(active)
      b.dataset.dir = active ? (sort.dir > 0 ? 'asc' : 'desc') : ''
      b.closest('.lib-cell').setAttribute('aria-sort', active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none')
    }
    vlist.setCount(visible.length)
  }
  const recomputeDebounced = debounce(recompute, 120)

  function renderRow(i) {
    const e = visible[i]
    const bs = bandStatsFor(stats, e.id, e.tier, band)
    const meta = metaCache.get(e.id)
    const score = bs ? `${formatPercent(bs.scoreLow)}<small> · ${formatGames(bs.games)}</small>` : '<span class="lib-muted">-</span>'
    const progress = meta
      ? `<span class="lib-pbar" aria-hidden="true"><i style="width:${Math.round(meta.pct * 100)}%"></i></span><span class="lib-num">${meta.masteredCount}/${meta.total}</span>`
      : '<span class="lib-muted">-</span>'
    return `
      <button type="button" class="lib-row" data-id="${e.id}" title="${escapeAttr(entryName(e))}">
        <span class="lib-cell lib-col-name">${escapeHtml(entryName(e))}</span>
        <span class="lib-cell lib-col-eco">${e.eco ?? '-'}</span>
        <span class="lib-cell lib-col-side">${t(`side.${e.side}`)}</span>
        <span class="lib-cell lib-col-family">${e.family ? t(`family.${e.family}`) : '-'}</span>
        <span class="lib-cell lib-col-difficulty">${dots(meta?.difficulty, t)}</span>
        <span class="lib-cell lib-col-score">${score}</span>
        <span class="lib-cell lib-col-progress">${progress}</span>
        <span class="lib-cell lib-col-due">${dueLabel(meta?.due) ?? '<span class="lib-muted">-</span>'}</span>
      </button>
    `
  }

  const mobileMq = window.matchMedia(MOBILE_QUERY)
  const rowHeight = () => (mobileMq.matches ? ROW_HEIGHT_MOBILE : ROW_HEIGHT)
  listHost.style.setProperty('--row-h', `${rowHeight()}px`)
  const vlist = createVirtualList(listHost, { rowHeight: rowHeight(), count: 0, renderRow })
  function onViewportChange() {
    listHost.style.setProperty('--row-h', `${rowHeight()}px`)
    vlist.setRowHeight(rowHeight())
  }
  mobileMq.addEventListener('change', onViewportChange)
  listHost.addEventListener('click', (ev) => {
    const row = ev.target.closest('.lib-row')
    if (row) navigate(`#/opening/${row.dataset.id}`)
  })

  // Remplit metaCache pour les entrées de l'onglet courant (difficulté, progression, échéance), puis
  // retrie : ces colonnes viennent de l'arbre, chargé à la demande. Une ouverture du catalogue complet
  // jamais jouée se lit dans l'index embarqué (ADR-0006), sans télécharger ses 3 815 arbres.
  let destroyed = false
  async function prefetchMeta() {
    const now = Date.now()
    for (const o of entriesForTab()) {
      if (destroyed) return
      if (metaCache.has(o.id)) continue
      const indexed = o.tier === 'catalog' && !state.progress[o.id] && !state.repertoire.includes(o.id) && catalogMeta(o.id)
      if (indexed) {
        metaCache.set(o.id, { total: indexed.lines, masteredCount: 0, pct: 0, difficulty: indexed.difficulty, due: null })
        continue
      }
      const { lines, header } = await getCachedLines(o)
      if (!lines.length) { metaCache.set(o.id, null); continue }
      const p = state.progress[o.id] || {}
      const masteredCount = lines.filter((l) => statusOf(p, l.id) === 'mastered').length
      metaCache.set(o.id, {
        total: lines.length,
        masteredCount,
        pct: masteredCount / lines.length,
        difficulty: difficultyOf(header),
        due: dueOf(lines, p, state.repertoire.includes(o.id), now),
      })
    }
    if (!destroyed) recompute()
  }

  function switchTab(next) {
    tab = next
    host.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)))
    // Le catalogue complet n'a pas de famille : un filtre resté actif afficherait une liste vide.
    familyEl.hidden = tab === 'catalog'
    if (tab === 'catalog') familyEl.value = 'all'
    recompute()
    prefetchMeta()
  }
  host.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)))
  for (const b of sideButtons) {
    b.addEventListener('click', () => {
      side = b.dataset.side
      sideButtons.forEach((x) => x.setAttribute('aria-checked', String(x === b)))
      recompute()
    })
  }
  for (const b of diffButtons) {
    b.addEventListener('click', () => {
      difficulty = b.dataset.difficulty
      diffButtons.forEach((button) => button.setAttribute('aria-pressed', String(button === b)))
      recompute()
    })
  }
  for (const b of sortButtons) {
    b.addEventListener('click', () => {
      const id = b.dataset.sort
      const col = COLUMNS.find((c) => c.id === id) || COLUMNS.find((c) => c.extra?.id === id).extra
      sort = sort.id === id ? { id, dir: -sort.dir } : { id, dir: col.dir }
      recompute()
    })
  }
  familyEl.addEventListener('change', recompute)
  host.querySelector('.lib-rating-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const elo = Number(host.querySelector('.lib-elo').value)
    if (!Number.isInteger(elo) || elo < 0 || elo > 3000) return
    await saveSettings({ elo, eloSource: host.querySelector('.lib-source').value })
    navigate(`#/library/${tab}`)
  })
  searchEl.addEventListener('input', () => {
    if (searchEl.value.trim() && tab === 'selection') switchTab('catalog')
    recomputeDebounced()
  })

  setActions({ search: () => searchEl.focus() })
  if (params.q) searchEl.value = params.q // #/library/catalog/B12 : une case de l'Atlas
  switchTab(tab)

  return {
    destroy() {
      destroyed = true
      vlist.destroy()
      mobileMq.removeEventListener('change', onViewportChange)
    },
  }
}
