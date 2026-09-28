// Écran Statistiques (spec section 6/7, chantier E3) : synthèse en tête (série de jours, lignes
// maîtrisées sur le total du répertoire, taux de réussite sans faute), puis un tableau par ouverture
// travaillée (au moins un run enregistré). Toutes les couleurs viennent des variables CSS déjà
// définies dans style.css (thèmes clair et sombre) : cet écran ne touche pas la feuille de style,
// hors de mon périmètre pour ce chantier.
import { selection, openings } from '../data.js'
import { openingStats, aggregateStats, globalStats } from '../core/stats.js'
import { recentInsights } from '../core/insights.js'
import { resolveOpening, getCachedLines, formatPercent, escapeHtml } from './shared.js'
import { t } from '../i18n.js'

const TILE_STYLE = 'flex:1 1 160px; padding:14px 16px; border-radius:6px; background:var(--surface); border:1px solid var(--line);'
const TILE_VALUE_STYLE = 'margin:0; font-size:28px; font-weight:700; color:var(--ink);'
const TILE_LABEL_STYLE = 'margin:4px 0 0; font-size:12.5px; color:var(--muted);'
const TH_STYLE = 'text-align:right; padding:8px 10px; color:var(--muted); font-weight:600; white-space:nowrap;'
const TD_STYLE = 'text-align:right; padding:8px 10px; white-space:nowrap;'
const ROW_STYLE = 'border-bottom:1px solid var(--line);'

function tile(value, label) {
  return `
    <div style="${TILE_STYLE}">
      <p class="mono" style="${TILE_VALUE_STYLE}">${value}</p>
      <p style="${TILE_LABEL_STYLE}">${label}</p>
    </div>
  `
}

function tableRow({ opening, stats }, tr) {
  return `
    <tr style="${ROW_STYLE}">
      <td style="padding:8px 10px">
        <a href="#/opening/${opening.id}" class="mono">${opening.name}</a>
        <small style="color:var(--muted)">· ${tr(`side.${opening.side}`)}</small>
      </td>
      <td class="mono" style="${TD_STYLE}">${stats.runs}</td>
      <td class="mono" style="${TD_STYLE}">${stats.successRate != null ? formatPercent(stats.successRate) : '-'}</td>
      <td class="mono" style="${TD_STYLE}">${stats.mastered}</td>
      <td class="mono" style="${TD_STYLE}">${stats.learning}</td>
      <td class="mono" style="${TD_STYLE}">${stats.review}</td>
      <td class="mono" style="${TD_STYLE}">${stats.fresh}</td>
      <td class="mono" style="${TD_STYLE}">${stats.total}</td>
    </tr>
  `
}

// Monté seul (ancienne route #/stats) ou dans l'onglet Statistiques de Progrès (`embedded`), sans
// titre ni fil d'Ariane. La série affichée est celle du jeu (gels compris) quand il est chargé.
export async function mount(host, ctx) {
  const { state, setActions, embedded = false, game } = ctx
  const tr = (key, values) => t(state.settings.locale, key, values)
  host.innerHTML = `
    ${embedded ? '' : `<p class="eyebrow"><a href="#/">${tr('today')}</a></p><h1>${tr('progress.stats')}</h1>`}
    <section class="card insights"></section>
    <div class="stats-summary"></div>
    <details class="stats-details"><summary>${tr('insights.details')}</summary><div class="stats-table-host"></div></details>
  `
  const summaryEl = host.querySelector('.stats-summary')
  const tableHost = host.querySelector('.stats-table-host')
  const insights = recentInsights({ puzzles: await ctx.getPuzzleAttempts(), activity: game?.events || [] })
  const nameOf = (group) => {
    if (group.kind === 'theme') return tr(`theme.${group.id}`)
    const opening = resolveOpening(group.id, { selection, openings })
    return state.settings.locale === 'fr' ? opening?.name || group.id : opening?.lichessName || opening?.name || group.id
  }
  const describe = (groups, empty) => groups.length ? `<ul>${groups.slice(0, 3).map((group) => `<li>${escapeHtml(nameOf(group))} · ${group.clean}/${group.count}</li>`).join('')}</ul>` : `<p>${tr(insights.eligible.length ? empty : 'insights.notEnough')}</p>`
  const href = insights.priority?.kind === 'theme' ? `#/exercises/theme/${encodeURIComponent(insights.priority.id)}` :
    insights.priority ? `#/train/${encodeURIComponent(insights.priority.id)}` : '#/exercises/mixed'
  host.querySelector('.insights').innerHTML = `
    <p class="eyebrow">${tr('insights.period')}</p>
    <h2>${tr('insights.title')}</h2>
    <p class="muted">${tr('insights.sample', { count: String(insights.count) })} · ${tr('insights.local')}</p>
    <div class="insights-pair">
      <div><b>${tr('insights.strength')}</b>${describe(insights.strengths, 'insights.noStrength')}</div>
      <div><b>${tr('insights.priority')}</b>${describe(insights.weaknesses, 'insights.noWeakness')}</div>
    </div>
    <a class="cta primary" href="${href}">${tr(insights.priority ? 'insights.action' : 'insights.start')} ↗</a>
    <p class="muted">${tr('insights.method')}</p>
  `

  if (!state.repertoire.length) {
    tableHost.innerHTML = `<p class="empty">${tr('stats.emptyRepertoire')}</p>`
    setActions({})
    return { destroy() {} }
  }

  const now = Date.now()
  const rows = []
  for (const openingId of state.repertoire) {
    const opening = resolveOpening(openingId, { selection, openings })
    if (!opening) continue
    const { lines } = await getCachedLines(opening)
    const progress = state.progress[openingId] || {}
    rows.push({ opening, stats: openingStats(lines, progress) })
  }
  const worked = rows.filter((r) => r.stats.runs > 0)
  const totals = aggregateStats(rows.map((r) => r.stats))
  const g = globalStats({ repertoire: state.repertoire, progress: state.progress, now })
  if (game) g.streak = game.state.streak.current

  summaryEl.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:12px; margin:16px 0 24px;">
      ${tile(g.streak, tr(g.streak === 1 ? 'stats.streakOne' : 'stats.streakMany'))}
      ${tile(`${totals.mastered}/${totals.total}`, tr('stats.masteredLines'))}
      ${tile(totals.successRate != null ? formatPercent(totals.successRate) : '-', tr('stats.flawlessRate'))}
    </div>
  `

  if (!worked.length) {
    tableHost.innerHTML = `<p class="empty">${tr('stats.noRuns')}</p>`
    setActions({})
    return { destroy() {} }
  }

  tableHost.innerHTML = `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:13px;">
        <thead>
          <tr style="${ROW_STYLE}">
            <th style="text-align:left; padding:8px 10px; color:var(--muted); font-weight:600;">${tr('stats.opening')}</th>
            <th style="${TH_STYLE}">${tr('stats.runs')}</th>
            <th style="${TH_STYLE}">${tr('stats.success')}</th>
            <th style="${TH_STYLE}">${tr('stats.mastered')}</th>
            <th style="${TH_STYLE}">${tr('stats.learning')}</th>
            <th style="${TH_STYLE}">${tr('stats.review')}</th>
            <th style="${TH_STYLE}">${tr('stats.new')}</th>
            <th style="${TH_STYLE}">${tr('stats.total')}</th>
          </tr>
        </thead>
        <tbody>${worked.map((row) => tableRow(row, tr)).join('')}</tbody>
      </table>
    </div>
  `

  setActions({})
  return { destroy() {} }
}
