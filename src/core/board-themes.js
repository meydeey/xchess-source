const BASE_THEMES = ['current', 'club']

// IDs from the v1 journal. Keep reading their confirmed results to honor saved board entitlements.
const LEGACY_REWARDS = [
  ['burrow', ['club-loose', 'club-mate', 'club-final']],
  ['code', ['tournament-pin', 'tournament-skewer', 'tournament-final']],
  ['passage', ['beyond-discovery', 'beyond-promotion', 'beyond-final']],
]
const LEGACY_ENCOUNTERS = new Set(LEGACY_REWARDS.flatMap(([, encounters]) => encounters))

export const BOARD_THEMES = [...BASE_THEMES, ...LEGACY_REWARDS.map(([theme]) => theme)]

export function boardThemesFor(events = []) {
  const facts = new Map()
  for (const outer of events) {
    const event = outer.kind === 'activity' ? outer.data?.event : outer
    if (event?.kind !== 'adventure') continue
    const fact = event.data
    if (fact?.seasonId !== 'white-rabbit-1' || fact.seasonVersion !== 1 || fact.encounterVersion !== 1 || !LEGACY_ENCOUNTERS.has(fact.encounterId)) continue
    if (typeof fact.attemptId !== 'string' || !fact.attemptId || !Number.isSafeInteger(fact.step) || fact.step < 0 || !fact.checkpoint || typeof fact.checkpoint !== 'object') continue
    const key = JSON.stringify([fact.encounterId, fact.attemptId, fact.step])
    const prior = facts.get(key)
    if (!prior || (event.at || 0) > (prior.at || 0) || event.at === prior.at && String(event.id) > String(prior.id)) facts.set(key, event)
  }
  const won = new Set()
  for (const { data: { checkpoint, encounterId } } of facts.values()) {
    if (checkpoint.phase === 'result' && checkpoint.confirmed === true && checkpoint.result === 'won') won.add(encounterId)
  }
  return [...BASE_THEMES, ...LEGACY_REWARDS.filter(([, encounters]) => encounters.every((id) => won.has(id))).map(([theme]) => theme)]
}

export function equippedBoardTheme(settings, availableThemes) {
  return availableThemes.includes(settings.boardTheme) ? settings.boardTheme : BASE_THEMES[0]
}
