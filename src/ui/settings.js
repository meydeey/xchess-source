// Réglages (spec section 7.5) : Elo et sa source, nouvelles lignes par jour, sons.
import { eloToBand } from '../core/metrics.js'
import { BOARD_THEMES, equippedBoardTheme } from '../core/board-themes.js'
import { ELO_SOURCE_LABEL, escapeHtml } from './shared.js'
import { GOALS, DEFAULT_GOAL } from '../core/game.js'
import { LOCALE_NAMES, resolveLocale } from '../i18n.js'
import * as sound from './sound.js'
import { MUSIC_TRACKS } from './music.js'

export async function mount(host, ctx) {
  const { state, availableBoardThemes, saveSettings, resetAllProgress, downloadBackup, restoreBackup, notify, setActions, t, music } = ctx
  const s = state.settings
  const locale = resolveLocale(s.locale)
  host.innerHTML = `
    <p class="eyebrow"><a href="#/">${t('today')}</a></p>
    <h1>${t('settings.title')}</h1>
    <section class="music-settings" aria-labelledby="music-title">
      <h2 id="music-title">${t('music.title')}</h2>
      <div class="music-settings-controls">
        <label for="music-track">${t('music.track')}
          <select id="music-track" lang="fr">
            ${MUSIC_TRACKS.map(({ title }, index) => `<option value="${index}">${escapeHtml(title)}</option>`).join('')}
          </select>
        </label>
        <div class="actions">
          <button type="button" class="music-play"></button>
          <button type="button" class="music-next">${t('music.next')}</button>
        </div>
      </div>
      <p class="music-status muted" role="status"></p>
    </section>
    <form class="settings-form">
      <label>${t('settings.language')}
        <select class="f-locale">
          ${Object.entries(LOCALE_NAMES).map(([value, name]) => `<option value="${value}" lang="${value}" ${locale === value ? 'selected' : ''}>${name}</option>`).join('')}
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
      <label>${t('settings.boardTheme')}
        <select class="f-board-theme">
          ${BOARD_THEMES.map((theme) => {
            const available = availableBoardThemes.includes(theme)
            const name = t(`board.${theme}`)
            return `<option value="${theme}" ${available ? '' : 'disabled'}>${available ? name : t('settings.boardThemeLocked', { theme: name })}</option>`
          }).join('')}
        </select>
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
    <details class="backup-settings app-information"${ctx.params?.help ? ' open' : ''}>
      <summary>${t('coach.support')}</summary>
      <p>${t('coach.localStorage')}</p>
      <ul>
        <li><a href="./support.html#${locale}">${t('settings.supportPage')}</a></li>
        <li><a href="./privacy.html#${locale}">${t('settings.privacyPolicy')}</a></li>
      </ul>
      <p class="release-info">${t('settings.version')} <code>${__XCHESS_RELEASE__}</code> · <a href="https://github.com/meydeey/xchess-source/tree/xchess-${__XCHESS_RELEASE__}" target="_blank" rel="noopener noreferrer">${t('settings.sourceCode')}</a></p>
    </details>
  `
  const eloEl = host.querySelector('.f-elo')
  const sourceEl = host.querySelector('.f-source')
  const newEl = host.querySelector('.f-new')
  const soundsEl = host.querySelector('.f-sounds')
  const boardThemeEl = host.querySelector('.f-board-theme')
  const selectedBoardTheme = () => equippedBoardTheme(state.settings, availableBoardThemes)
  boardThemeEl.value = selectedBoardTheme()
  const bandHint = host.querySelector('.band-hint')
  if (ctx.params?.help) host.querySelector('.app-information summary').focus()

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
  boardThemeEl.addEventListener('change', async () => {
    const theme = boardThemeEl.value
    boardThemeEl.value = selectedBoardTheme()
    if (boardThemeEl.disabled || !availableBoardThemes.includes(theme) || theme === boardThemeEl.value) return
    boardThemeEl.disabled = true
    try {
      await saveSettings({ boardTheme: theme })
    } finally {
      boardThemeEl.value = selectedBoardTheme()
      boardThemeEl.disabled = false
    }
  })
  host.querySelector('.btn-test-sound').addEventListener('click', async () => {
    try { await sound.test() } catch (error) { notify(t('settings.soundError', { reason: String(error) })) }
  })
  const backupExport = host.querySelector('.btn-backup-export')
  backupExport.addEventListener('click', async () => {
    backupExport.disabled = true
    try { await downloadBackup() } catch { notify(t('settings.exportFailed')) }
    finally { backupExport.disabled = false }
  })
  const backupFile = host.querySelector('.backup-file')
  host.querySelector('.btn-backup-import').addEventListener('click', () => backupFile.click())
  backupFile.addEventListener('change', async () => {
    if (!backupFile.files?.[0]) return
    try { await restoreBackup(backupFile.files[0]) } catch { notify(t('settings.importFailed')) }
    backupFile.value = ''
  })
  host.querySelector('.btn-reset').addEventListener('click', () => {
    if (!confirm(t('settings.resetConfirm'))) return
    resetAllProgress()
  })

  const track = host.querySelector('#music-track')
  const playMusic = host.querySelector('.music-play')
  const musicStatus = host.querySelector('.music-status')
  track.addEventListener('change', () => { music.select(Number(track.value)) })
  playMusic.addEventListener('click', () => { music.toggle() })
  host.querySelector('.music-next').addEventListener('click', () => { music.next() })
  const unsubscribeMusic = music.subscribe(({ index, status }) => {
    track.value = String(index)
    playMusic.textContent = t(status === 'playing' ? 'music.pause' : status === 'loading' ? 'music.cancel' : 'music.play')
    musicStatus.textContent = t(`music.${status}`, { track: MUSIC_TRACKS[index].title })
  })

  setActions({})
  return { destroy: unsubscribeMusic }
}
