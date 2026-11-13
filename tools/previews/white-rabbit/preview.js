import { styles, outfits, boards, reactions, devices, choiceFrom, choiceParams, rabbitUrl } from './model.js'

const storageKey = 'xchess-white-rabbit-preview-v1'
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let choice = choiceFrom(new URLSearchParams(location.search))
if (!location.search) {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) choice = choiceFrom(new URLSearchParams(saved))
    else choice.motion = !reducedMotion.matches
  } catch { choice.motion = !reducedMotion.matches }
}
const $ = (selector) => document.querySelector(selector)
const scene = $('#scene')
const reference = $('#reference')
const measurements = new Map()

function button(group, id, content) {
  return `<button type="button" data-group="${group}" data-value="${id}" aria-pressed="false">${content}</button>`
}

$('#style-choices').innerHTML = styles.map((style) => button('style', style.id, `<img src="${rabbitUrl({ style: style.id, outfit: 'origin' })}" alt="" width="64" height="88"><span>${style.name}</span>`)).join('')
$('#outfit-choices').innerHTML = outfits.map((outfit) => button('outfit', outfit.id, outfit.name)).join('')
$('#board-choices').innerHTML = boards.map((board) => button('board', board.id, `<span class="swatch theme-${board.id}" aria-hidden="true"></span><span>${board.name}</span>`)).join('')
$('#reaction-choices').innerHTML = reactions.map((reaction) => button('reaction', reaction.id, reaction.name)).join('')
$('#device-choices').innerHTML = devices.map((device) => button('device', device.id, device.name)).join('')
$('#gallery-grid').innerHTML = styles.map((style) => `<section class="gallery-style"><h3>${style.name}</h3><p>${style.summary}</p><div class="gallery-outfits">${outfits.map((outfit) => `<button type="button" class="rabbit-card" data-style="${style.id}" data-outfit="${outfit.id}" aria-pressed="false"><img src="${rabbitUrl({ style: style.id, outfit: outfit.id })}" alt="Lapin ${outfit.name}, ${style.name}" width="220" height="260" loading="lazy" class="${style.id === 'pixel' ? 'pixel' : ''}"><span>${outfit.name}</span></button>`).join('')}</div></section>`).join('')

function updateMeasurements() {
  const selected = measurements.get('selected')
  const baseline = measurements.get('baseline')
  if (!selected || !baseline) return
  const device = devices.find((item) => item.id === choice.device)
  if (selected.viewport !== device.width || baseline.viewport !== device.width) return
  const delta = selected.width - baseline.width
  $('#board-measure').textContent = `Plateau : ${Math.round(selected.width)} px de côté · référence ${Math.round(baseline.width)} px · ${delta >= -1 ? 'surface préservée' : 'surface réduite'} (${delta >= 0 ? '+' : ''}${Math.round(delta)} px). Dimensions avant réduction de l’aperçu.`
}

function fitDevices() {
  const device = devices.find((item) => item.id === choice.device)
  for (const space of document.querySelectorAll('.device-space')) {
    const width = space.clientWidth || scene.parentElement.clientWidth
    const scale = Math.min(1, width / device.width, 700 / device.height)
    const iframe = space.querySelector('iframe')
    iframe.style.width = `${device.width}px`
    iframe.style.height = `${device.height}px`
    iframe.style.transform = `scale(${scale})`
    space.style.height = `${device.height * scale}px`
    if (iframe === scene) $('#scale-caption').textContent = `Aperçu à ${Math.round(scale * 100)} %`
  }
}

function publishChoice() {
  const payload = { type: 'white-rabbit-choice', params: choiceParams(choice).toString() }
  scene.contentWindow?.postMessage(payload, location.origin)
  reference.contentWindow?.postMessage(payload, location.origin)
}

function update({ replaceUrl = true } = {}) {
  for (const element of document.querySelectorAll('[data-group]')) element.setAttribute('aria-pressed', String(choice[element.dataset.group] === element.dataset.value))
  for (const element of document.querySelectorAll('.rabbit-card')) element.setAttribute('aria-pressed', String(choice.style === element.dataset.style && choice.outfit === element.dataset.outfit))
  $('#outfit-note').textContent = outfits.find((item) => item.id === choice.outfit).note
  $('#board-note').textContent = boards.find((item) => item.id === choice.board).note
  $('#composition-label').textContent = `${styles.find((item) => item.id === choice.style).name} · ${outfits.find((item) => item.id === choice.outfit).name} · ${boards.find((item) => item.id === choice.board).name}`
  const device = devices.find((item) => item.id === choice.device)
  $('#device-caption').textContent = `${device.width} × ${device.height} px`
  $('#motion').checked = choice.motion
  $('#baseline').checked = choice.baseline
  $('#motion-note').textContent = reducedMotion.matches ? 'Le mouvement réduit de ton appareil reste prioritaire.' : 'Les mouvements illustrent les réactions ; les poses définitives viendront ensuite.'
  $('.reference-column').classList.toggle('reference-hidden', !choice.baseline)
  $('.reference-column').setAttribute('aria-hidden', String(!choice.baseline))
  $('.reference-column').inert = !choice.baseline
  $('.preview-pair').classList.toggle('comparing', choice.baseline)
  $('#small-rabbit').src = rabbitUrl(choice)
  $('#small-rabbit').classList.toggle('pixel', choice.style === 'pixel')
  const url = new URL(location.href)
  url.search = choiceParams(choice).toString()
  $('#choice-link').value = url.href
  if (replaceUrl) history.replaceState(null, '', url)
  fitDevices()
  publishChoice()
}

document.addEventListener('click', (event) => {
  const control = event.target.closest('[data-group]')
  const rabbit = event.target.closest('.rabbit-card')
  if (control) choice[control.dataset.group] = control.dataset.value
  else if (rabbit) {
    choice.style = rabbit.dataset.style
    choice.outfit = rabbit.dataset.outfit
  } else return
  $('#saved-status').textContent = ''
  update()
})
for (const key of ['motion', 'baseline']) $(`#${key}`).addEventListener('change', (event) => {
  choice[key] = event.target.checked
  update()
})
$('#save-choice').addEventListener('click', () => {
  try {
    localStorage.setItem(storageKey, choiceParams(choice).toString())
    $('#saved-status').textContent = 'Combinaison gardée dans ce navigateur. Tu peux encore la modifier.'
  } catch { $('#saved-status').textContent = 'Enregistrement indisponible. Le lien ci-dessous conserve ta combinaison.' }
})
$('#copy-link').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#choice-link').value)
    $('#saved-status').textContent = 'Lien copié. Tu peux me le transmettre pour choisir cette direction.'
  } catch {
    $('#choice-link').focus()
    $('#choice-link').select()
    $('#saved-status').textContent = 'Le lien est sélectionné, tu peux le copier.'
  }
})
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || ![scene.contentWindow, reference.contentWindow].includes(event.source)) return
  if (event.data?.type === 'white-rabbit-ready') publishChoice()
  if (event.data?.type === 'white-rabbit-reaction' && reactions.some((item) => item.id === event.data.reaction)) {
    choice.reaction = event.data.reaction
    update()
  }
  if (event.data?.type === 'white-rabbit-measure') {
    measurements.set(event.source === scene.contentWindow ? 'selected' : 'baseline', event.data)
    updateMeasurements()
  }
})
scene.addEventListener('load', publishChoice)
reference.addEventListener('load', publishChoice)
new ResizeObserver(fitDevices).observe($('.preview-pair'))
reducedMotion.addEventListener('change', () => update())
update()
