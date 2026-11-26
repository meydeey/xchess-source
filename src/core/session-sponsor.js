export function readSponsor(input) {
  if (!input) return null
  try {
    const { advertiser, message, url, reportEmail } = JSON.parse(input)
    const destination = new URL(url)
    if (destination.protocol !== 'https:' || destination.username || destination.password) return null
    if (typeof advertiser !== 'string' || !advertiser.trim() || typeof message !== 'string' || !message.trim()) return null
    if (typeof reportEmail !== 'string' || !/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(reportEmail)) return null
    return { advertiser: advertiser.trim(), message: message.trim(), reportEmail }
  } catch {
    return null
  }
}

export function recordSponsorOpportunity(previous, day, mayShow) {
  const count = previous?.completed
  const completed = Number.isInteger(count) && count > 0 ? 2 : 1
  const lastShownOn = /^\d{4}-\d{2}-\d{2}$/.test(previous?.lastShownOn) ? previous.lastShownOn : null
  const show = mayShow && completed === 2 && (!lastShownOn || lastShownOn < day)
  return { history: { completed, lastShownOn: show ? day : lastShownOn }, show }
}
