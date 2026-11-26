import { invoke } from '@tauri-apps/api/core'
import { platform } from '../platform/index.js'
import { localDateStr } from '../core/srs.js'
import { readSponsor, recordSponsorOpportunity } from '../core/session-sponsor.js'

const appleStore = import.meta.env.VITE_XCHESS_STORE === '1'
  && ['darwin', 'ios'].includes(import.meta.env.TAURI_ENV_PLATFORM)
const sponsor = appleStore
  ? readSponsor(import.meta.env.VITE_XCHESS_SPONSOR)
  : null
const HISTORY_KEY = 'sessionSponsorHistory'
let reservation = Promise.resolve()

export function mountSessionSponsor(host, t) {
  if (!sponsor || platform.kind !== 'tauri') return
  reservation = reservation.then(async () => {
    if (!host.isConnected) return
    const previous = await platform.store.get(HISTORY_KEY)
    const { history, show } = recordSponsorOpportunity(previous, localDateStr(Date.now()), navigator.onLine)
    if (await platform.store.set(HISTORY_KEY, history) && show && host.isConnected) renderSponsor(host, t)
  }).catch(() => {})
}

function renderSponsor(host, t) {
  const slot = document.createElement('aside')
  slot.className = 'session-sponsor'
  slot.setAttribute('aria-label', t('coach.adLabel'))
  slot.innerHTML = `
    <p class="sponsor-label">${t('coach.adLabel')}</p>
    <p class="sponsor-advertiser"><strong></strong></p>
    <p class="sponsor-message"></p>
    <div class="actions">
      <button class="link sponsor-destination" type="button">${t('coach.adVisit')}</button>
      <button class="link sponsor-dismiss" type="button">${t('coach.adHide')}</button>
    </div>
    <details>
      <summary>${t('coach.adDetails')}</summary>
      <p>${t('coach.adWhy')}</p>
      <button class="link sponsor-report" type="button">${t('coach.adReport')}</button>
      <p class="sponsor-contact"></p>
    </details>
    <p class="sponsor-status" role="status"></p>`
  slot.querySelector('strong').textContent = sponsor.advertiser
  slot.querySelector('.sponsor-message').textContent = sponsor.message
  slot.querySelector('.sponsor-contact').textContent = sponsor.reportEmail
  const status = slot.querySelector('.sponsor-status')
  for (const target of ['destination', 'report']) {
    const button = slot.querySelector(`.sponsor-${target}`)
    button.addEventListener('click', async () => {
      status.textContent = ''
      button.disabled = true
      try {
        await invoke('open_sponsor_link', { target })
      } catch {
        status.textContent = t(target === 'report' ? 'coach.adReportUnavailable' : 'coach.adVisitUnavailable')
      } finally {
        button.disabled = false
      }
    })
  }
  slot.querySelector('.sponsor-dismiss').addEventListener('click', () => {
    slot.remove()
    host.querySelector('.cta.primary')?.focus({ preventScroll: true })
  })
  host.append(slot)
}
