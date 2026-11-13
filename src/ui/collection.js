import { Chessground } from 'chessground'
import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.cburnett.css'
import { RABBITS, BOARD_THEMES, RABBIT_POSES, PENDING_RABBIT_ART, appearanceState, rabbitAsset } from '../core/appearance.js'
import { mountCompanion } from './companion.js'

export async function mount(host, ctx) {
  const { t, state } = ctx
  const collection = await ctx.getCollection()
  let equipped = appearanceState(state.settings, collection)
  let preview = { rabbit: equipped.rabbit, board: equipped.board }
  let busy = false
  host.innerHTML = `
    <p class="eyebrow"><a href="#/">${t('today')}</a></p><h1>${t('collection.title')}</h1>
    <p class="collection-summary">${t('collection.summary')}</p>
    <div class="collection-layout">
      <section class="collection-preview" aria-label="${t('collection.preview')}">
        <div class="collection-scene" data-board-preview="${preview.board}"><div class="board-frame"><div class="cg-wrap"></div></div><div class="collection-companion"></div></div>
        <label class="collection-pose">${t('collection.pose')} <select>${RABBIT_POSES.map((pose) => `<option value="${pose}">${t(`pose.${pose}`)}</option>`).join('')}</select></label>
        <p class="collection-preview-note">${t('collection.previewOnly')}</p>
        <div class="collection-preferences">${[['companionVisible', 'presence'], ['companionComments', 'comments'], ['companionAnimations', 'animations']].map(([key, name]) => `<label><input type="checkbox" data-setting="${key}" ${state.settings[key] !== false ? 'checked' : ''}> ${t(`collection.${name}`)}</label>`).join('')}</div>
        <p class="collection-preview-note">${t('collection.motionNote')}</p>${PENDING_RABBIT_ART.length ? `<p class="collection-preview-note">${t('collection.artPending', { count: 49 - PENDING_RABBIT_ART.length, missing: PENDING_RABBIT_ART.map((id) => { const [skin, pose] = id.split('-'); return `${t(`skin.${skin}`)} : ${t(`pose.${pose}`)}` }).join(', ') })}</p>` : ''}
        <p class="collection-status" role="status" aria-live="polite"></p>
      </section>
      <div class="collection-choices"><section><h2>${t('collection.skins')}</h2><div class="skin-grid">${RABBITS.map((skin) => `
        <article class="skin-card" data-rabbit="${skin.id}"><button type="button" class="skin-try" data-try-rabbit="${skin.id}" aria-label="${t('collection.try')} ${t(`skin.${skin.id}`)}"><img src="${rabbitAsset(skin.id)}" alt="${t(`skin.${skin.id}`)}" width="160" height="180" loading="lazy"></button><h3>${t(`skin.${skin.id}`)}</h3><p>${t(`skin.${skin.id}.rule`)}${skin.practice && !collection.rabbits.includes(skin.id) ? ` <b>${Math.min(collection.progress[skin.practice.category], skin.practice.count)}/${skin.practice.count}</b>` : ''}</p><button type="button" data-equip-rabbit="${skin.id}"></button></article>`).join('')}</div><p class="collection-preview-note">${t('collection.distinct')}</p></section>
      <section><h2>${t('collection.boards')}</h2><div class="board-theme-grid">${BOARD_THEMES.map((theme) => `<article class="board-theme-card" data-board="${theme.id}"><button type="button" data-try-board="${theme.id}" aria-label="${t('collection.try')} ${t(`board.${theme.id}`)}"><span class="board-swatch" data-board-preview="${theme.id}" aria-hidden="true"></span><b>${t(`board.${theme.id}`)}</b></button><p>${t(`board.${theme.id}.rule`)}</p><button type="button" data-equip-board="${theme.id}"></button></article>`).join('')}</div></section></div>
    </div>`
  const status = host.querySelector('.collection-status')
  const scene = host.querySelector('.collection-scene')
  const chessground = Chessground(scene.querySelector('.cg-wrap'), {
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    viewOnly: true, coordinates: true, drawable: { enabled: false, visible: false }, animation: { enabled: false },
  })
  const companion = mountCompanion(host.querySelector('.collection-companion'), ctx, { rabbit: preview.rabbit, collection, preview: true })
  function refresh() {
    const poses = host.querySelector('.collection-pose select')
    for (const option of poses.options) {
      option.disabled = PENDING_RABBIT_ART.includes(`${preview.rabbit}-${option.value}`)
      option.textContent = t(`pose.${option.value}`) + (option.disabled ? ` (${t('collection.unavailable')})` : '')
    }
    if (poses.selectedOptions[0].disabled) poses.value = 'idle'
    companion.showPose(poses.value)
    for (const checkbox of host.querySelectorAll('[data-setting]')) checkbox.disabled = busy
    scene.dataset.boardPreview = preview.board
    companion.setRabbit(preview.rabbit)
    for (const kind of ['rabbit', 'board']) {
      const owned = collection[kind === 'rabbit' ? 'rabbits' : 'boards']
      for (const button of host.querySelectorAll(`[data-equip-${kind}]`)) {
        const id = button.dataset[kind === 'rabbit' ? 'equipRabbit' : 'equipBoard']
        button.disabled = busy || !owned.includes(id) || equipped[kind] === id
        button.textContent = t(!owned.includes(id) ? 'collection.locked' : equipped[kind] === id ? 'collection.equipped' : 'collection.equip')
      }
      for (const button of host.querySelectorAll(`[data-try-${kind}]`)) button.setAttribute('aria-pressed', String(button.dataset[kind === 'rabbit' ? 'tryRabbit' : 'tryBoard'] === preview[kind]))
    }
  }
  async function equip(kind, id) {
    if (busy || !collection[kind === 'rabbit' ? 'rabbits' : 'boards'].includes(id)) return
    busy = true
    status.textContent = t('collection.saving')
    refresh()
    try {
      const ok = await ctx.saveSettings({ [kind === 'rabbit' ? 'rabbitOutfit' : 'boardTheme']: id })
      if (!ok) throw new Error('save')
      equipped = appearanceState(state.settings, collection)
      preview[kind] = id
      status.textContent = t('collection.saved')
    } catch { status.textContent = t('collection.saveError') }
    busy = false
    refresh()
  }
  host.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    if (button.dataset.tryRabbit) preview.rabbit = button.dataset.tryRabbit
    if (button.dataset.tryBoard) preview.board = button.dataset.tryBoard
    if (button.dataset.equipRabbit) return equip('rabbit', button.dataset.equipRabbit)
    if (button.dataset.equipBoard) return equip('board', button.dataset.equipBoard)
    refresh()
  })
  host.querySelector('.collection-pose select').addEventListener('change', (event) => companion.showPose(event.target.value))
  for (const checkbox of host.querySelectorAll('[data-setting]')) checkbox.addEventListener('change', async () => {
    if (busy) return
    busy = true
    status.textContent = t('collection.saving')
    refresh()
    try {
      if (!await ctx.saveSettings({ [checkbox.dataset.setting]: checkbox.checked })) throw new Error('save')
      companion.setPreferences(appearanceState(state.settings, collection))
      status.textContent = t('collection.saved')
    } catch { status.textContent = t('collection.saveError') }
    busy = false
    refresh()
  })
  ctx.setActions({})
  refresh()
  return { destroy() { companion.destroy(); chessground.destroy() } }
}
