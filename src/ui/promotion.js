export function showPromotion(el, { dest, color, orientation, t }) {
  const file = dest.charCodeAt(0) - 97
  el.style.setProperty('--promotion-left', `${(orientation === 'white' ? file : 7 - file) * 12.5}%`)
  el.dataset.edge = dest[1] === (orientation === 'white' ? '8' : '1') ? 'top' : 'bottom'
  const side = color === 'w' ? 'white' : 'black'
  const names = { q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }
  el.innerHTML = `<div class="promotion-menu">${['q', 'r', 'b', 'n'].map((code) =>
    `<button type="button" data-piece="${code}" aria-label="${t('exercises.promotion')} : ${t(`promotion.${code}`)}"><span class="cg-wrap"><piece class="${side} ${names[code]}"></piece></span></button>`).join('')}</div>`
  el.hidden = false
  el.querySelector('button')?.focus({ preventScroll: true })
  el.parentElement.scrollIntoView({ block: 'center', behavior: 'auto' })
}
