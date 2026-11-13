import season from '../../catalog/adventure-season-1.json'
import { rabbitAsset } from '../core/appearance.js'
import { escapeHtml } from './shared.js'

export const textOf = (value, locale) => value?.[locale] || value?.en || value?.fr || ''
export function currentEncounter(progress) {
  const active = season.encounters.filter((encounter) => progress.available.includes(encounter.id) && !progress.encounters[encounter.id].won)
  return active.sort((a, b) => Math.max(0, ...Object.values(progress.encounters[b.id].attempts).map((item) => item.at)) - Math.max(0, ...Object.values(progress.encounters[a.id].attempts).map((item) => item.at)))[0] || null
}
export function adventureEntry(ctx, progress) {
  const encounter = currentEncounter(progress)
  return `<a class="adventure-entry" href="#/adventure${encounter ? '/' + encounter.id : ''}"><img src="${rabbitAsset(ctx.appearance().rabbit)}" alt="" width="72" height="88"><span><b>${ctx.t('adventure.continue')}</b><small>${encounter ? escapeHtml(textOf(encounter.title, ctx.state.settings.locale)) : ctx.t('adventure.title')}</small></span><span aria-hidden="true">↗</span></a>`
}
export function portrait(index, name) {
  const n = Number.isInteger(index) ? Math.max(0, Math.min(8, index)) : 0
  const coats = ['#5b7766', '#8c624b', '#45596b', '#767048', '#765568', '#356d65', '#51557c', '#8a6b52', '#313c4e']
  const skin = ['#dcb394', '#a66c4e', '#f0c7a2'][n % 3]
  const hair = n % 2 ? '<path d="M29 49V32q19-27 43 1v17L62 33 39 37z" fill="#3f342f"/>' : '<path d="M28 48V31q22-26 45 4l-12 1-12-10-10 14z" fill="#54453b"/>'
  const glasses = n % 3 === 0 ? '<g fill="none" stroke="#39463e" stroke-width="2"><rect x="33" y="44" width="14" height="10" rx="4"/><rect x="53" y="44" width="14" height="10" rx="4"/><path d="M47 48h6"/></g>' : ''
  return `<svg class="adventure-portrait" viewBox="0 0 100 112" role="img" aria-label="${escapeHtml(name)}"><rect width="100" height="112" rx="16" fill="#e2dfd0"/><path d="M10 112v-9q2-28 40-28t40 28v9" fill="${coats[n]}"/><path d="M43 70v15l7 8 8-8V70" fill="${skin}"/><ellipse cx="50" cy="49" rx="23" ry="29" fill="${skin}"/>${hair}<g fill="#302f2b"><circle cx="40" cy="49" r="2"/><circle cx="60" cy="49" r="2"/></g><path d="M50 51l-2 9h5M43 67q7 5 14-1" fill="none" stroke="#805f4e" stroke-width="1.5" stroke-linecap="round"/>${glasses}</svg>`
}
