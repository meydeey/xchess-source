export function rankArt(level) {
  if (level >= 25) return 'legendary'
  if (level >= 15) return 'epic'
  if (level >= 5) return 'rare'
  return 'common'
}

export function challengeArt(stage) {
  return {
    foundations: 'common',
    intermediate: 'rare',
    club: 'epic',
    advanced: 'epic',
    expert: 'legendary',
  }[stage] || 'common'
}

export function rankMedallion(level, className = 'reward-medallion') {
  return `<img class="${className}" src="/art/rewards/rank-${rankArt(level)}.webp" width="192" height="192" alt="" decoding="async">`
}
