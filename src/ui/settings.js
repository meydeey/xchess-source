// Réglages (spec section 7.5) : Elo et sa source, nouvelles lignes par jour, sons.
import { eloToBand } from '../core/metrics.js'
import { ELO_SOURCE_LABEL } from './shared.js'
import { GOALS, DEFAULT_GOAL } from '../core/game.js'
import * as sound from './sound.js'

export async function mount(host, ctx) {
  const { state, saveSettings, resetAllProgress, downloadBackup, restoreBackup, notify, setActions, t } = ctx
  const s = state.settings
  host.innerHTML = `
    <p class="eyebrow"><a href="#/">${t('today')}</a></p>
    <h1>${t('settings.title')}</h1>
    <form class="settings-form">
      <label>${t('settings.language')}
        <select class="f-locale">
          <option value="en" ${s.locale === 'en' ? 'selected' : ''}>English</option>
          <option value="fr" ${s.locale === 'fr' ? 'selected' : ''}>Français</option>
          <option value="es" ${s.locale === 'es' ? 'selected' : ''}>Español</option>
        </select>
      </label>
      <label>${t('settings.elo')}
        <input type="number" class="f-elo" min="0" max="3000" step="1" value="${s.elo}">
      </label>
      <label>${t('settings.source')}
        <select class="f-source">
          ${Object.entries(ELO_SOURCE_LABEL).map(([k, v]) => `<option value="${k}" ${k === s.eloSource ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </label>
      <p class="band-hint mono"></p>
      <label>${t('settings.new')}
        <input type="number" class="f-new" min="1" max="50" step="1" value="${s.newPerDay}">
      </label>
      <label>${t('settings.goal')}
        <select class="f-goal">
          ${Object.keys(GOALS).map((xp) => `<option value="${xp}" ${Number(xp) === (s.dailyGoal || DEFAULT_GOAL) ? 'selected' : ''}>${t(`goal.${xp}`)} : ${xp} XP</option>`).join('')}
        </select>
      </label>
      <label class="checkbox">
        <input type="checkbox" class="f-sounds" ${s.sounds ? 'checked' : ''}> ${t('settings.sounds')}
        <button type="button" class="btn-test-sound link">${t('settings.testSound')}</button>
      </label>
    </form>
    <section class="backup-settings" aria-labelledby="backup-title">
      <h2 id="backup-title">${t('settings.backup')}</h2>
      <p>${t('settings.backupDesc')}</p>
      <div class="backup-actions">
        <button type="button" class="btn-backup-export">${t('settings.export')}</button>
        <button type="button" class="btn-backup-import">${t('settings.import')}</button>
        <input type="file" class="backup-file" accept="application/json,.json" hidden>
      </div>
    </section>
    <button type="button" class="btn-reset link danger">${t('settings.reset')}</button>
    <p class="release-info">${t('settings.version')} <code>${__XCHESS_RELEASE__}</code> · <a href="https://github.com/meydeey/xchess-source/tree/xchess-${__XCHESS_RELEASE__}" target="_blank" rel="noopener noreferrer">${t('settings.sourceCode')}</a></p>
  `
  const eloEl = host.querySelector('.f-elo')
  const sourceEl = host.querySelector('.f-source')
  const newEl = host.querySelector('.f-new')
  const soundsEl = host.querySelector('.f-sounds')
  const bandHint = host.querySelector('.band-hint')

  function refreshBandHint() {
    const band = eloToBand(Number(eloEl.value) || 0, sourceEl.value)
    bandHint.textContent = t('settings.band', { band: t(`band.${band}`) })
  }
  refreshBandHint()

  host.querySelector('.f-locale').addEventListener('change', async (event) => {
    await saveSettings({ locale: event.target.value })
    ctx.navigate('#/settings')
  })

  eloEl.addEventListener('change', () => { saveSettings({ elo: Number(eloEl.value) || 0 }); refreshBandHint() })
  sourceEl.addEventListener('change', () => { saveSettings({ eloSource: sourceEl.value }); refreshBandHint() })
  newEl.addEventListener('change', () => saveSettings({ newPerDay: Math.max(1, Number(newEl.value) || 1) }))
  soundsEl.addEventListener('change', () => saveSettings({ sounds: soundsEl.checked }))
  host.querySelector('.f-goal').addEventListener('change', (e) => saveSettings({ dailyGoal: Number(e.target.value) }))
  host.querySelector('.btn-test-sound').addEventListener('click', async () => {
    try { await sound.test() } catch (error) { notify(t('settings.soundError', { reason: String(error) })) }
  })
  host.querySelector('.btn-backup-export').addEventListener('click', async () => {
    try { await downloadBackup() } catch (error) { notify(error.message) }
  })
  const backupFile = host.querySelector('.backup-file')
  host.querySelector('.btn-backup-import').addEventListener('click', () => backupFile.click())
  backupFile.addEventListener('change', async () => {
    if (!backupFile.files?.[0]) return
    try { await restoreBackup(backupFile.files[0]) } catch (error) { notify(error.message) }
    backupFile.value = ''
  })
  host.querySelector('.btn-reset').addEventListener('click', () => {
    if (!confirm(t('settings.resetConfirm'))) return
    resetAllProgress()
  })

  setActions({})
  return { destroy() {} }
}
