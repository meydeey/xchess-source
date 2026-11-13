import { rabbitAsset, appearanceState } from '../core/appearance.js'
import { reactionFor } from '../core/companion.js'

export function mountCompanion(host, ctx, { collection, rabbit = null, preview = false } = {}) {
  const preferences = appearanceState(ctx.state.settings, collection)
  if (preview) preferences.visible = true
  const element = document.createElement('div')
  element.className = 'rabbit-companion'
  element.innerHTML = '<img width="72" height="88" alt=""><p role="status" aria-live="polite"></p>'
  host.append(element)
  const image = element.querySelector('img')
  const words = element.querySelector('p')
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  let outfit = rabbit || preferences.rabbit
  let pose = 'idle'
  let scope = null
  let comments = 0
  let blinking = null
  let resting = null
  let destroyed = false
  image.alt = ctx.t('companion.name')

  function showPose(next) {
    pose = next
    element.dataset.pose = pose
    image.src = new URL(rabbitAsset(outfit, pose), document.baseURI).href
  }
  function motion() {
    element.dataset.animate = String(preferences.animations && !reducedMotion.matches)
  }
  function blink() {
    if (destroyed) return
    if (pose === 'idle' && preferences.animations && !reducedMotion.matches) {
      showPose('blink')
      blinking = setTimeout(() => { if (pose === 'blink') showPose('idle'); blinking = setTimeout(blink, 6500) }, 180)
    } else blinking = setTimeout(blink, 6500)
  }
  function react(facts) {
    const nextScope = facts.scope || facts.id || scope
    if (nextScope !== scope) { scope = nextScope; comments = 0; words.textContent = '' }
    const reaction = reactionFor(facts, preferences)
    element.hidden = !reaction.visible
    clearTimeout(resting)
    showPose(reaction.pose)
    if (!preview && reaction.pose !== 'idle' && facts.type !== 'thinking') resting = setTimeout(() => showPose('idle'), 2600)
    const limit = facts.duel ? 2 : 1
    if (reaction.key && (facts.requested || facts.final || comments < limit)) {
      words.textContent = ctx.t(reaction.key, reaction.values)
      if (!facts.requested && !facts.final) comments++
    }
  }
  element.hidden = !preferences.visible
  reducedMotion.addEventListener('change', motion)
  motion()
  showPose('idle')
  if (!preview) blinking = setTimeout(blink, 6500)
  return {
    react,
    showPose,
    setPreferences(next) {
      Object.assign(preferences, next)
      if (preview) preferences.visible = true
      element.hidden = !preferences.visible
      if (!preferences.comments) words.textContent = ''
      motion()
    },
    setRabbit(value) { outfit = value; showPose(pose) },
    destroy() {
      destroyed = true
      clearTimeout(blinking)
      clearTimeout(resting)
      reducedMotion.removeEventListener('change', motion)
      element.remove()
    },
  }
}

// Panels may appear later when a trainer switches to exploration or Stockfish play.
// Only insert into new information panels; never rebuild a board to add a companion.
export function mountBoardCompanions(root, ctx, collection) {
  const panels = new Map()
  function scan() {
    for (const [panel, companion] of panels) if (!root.contains(panel)) { companion.destroy(); panels.delete(panel) }
    for (const panel of root.querySelectorAll('.drill-info, .games-drill-info')) {
      if (!panels.has(panel) && root.querySelector('.cg-wrap')) panels.set(panel, mountCompanion(panel, ctx, { collection }))
    }
  }
  const observer = new MutationObserver(scan)
  observer.observe(root, { childList: true, subtree: true })
  scan()
  return {
    react(facts) { for (const [panel, companion] of panels) if (panel.getClientRects().length) companion.react(facts) },
    destroy() { observer.disconnect(); for (const companion of panels.values()) companion.destroy(); panels.clear() },
  }
}
