import { expect, test } from 'bun:test'
import { readSponsor, recordSponsorOpportunity } from '../src/core/session-sponsor.js'

test('a public sponsor is optional and must use a safe destination and report address', () => {
  const fixture = { advertiser: ' Example ', message: ' Chess supplies ', url: 'https://example.com/chess', reportEmail: 'report@example.com' }
  expect(readSponsor(undefined)).toBeNull()
  expect(readSponsor('{')).toBeNull()
  expect(readSponsor(JSON.stringify(fixture))).toEqual({ advertiser: 'Example', message: 'Chess supplies', reportEmail: 'report@example.com' })
  for (const invalid of [
    { ...fixture, url: 'http://example.com' },
    { ...fixture, url: 'https://user:pass@example.com' },
    { ...fixture, reportEmail: 'report@example.com?bcc=alternate@example.com' },
    { ...fixture, reportEmail: 'report%0D%0A@example.com' },
  ]) {
    expect(readSponsor(JSON.stringify(invalid))).toBeNull()
  }
})

test('a sponsor can first appear after the second completed session', () => {
  const first = recordSponsorOpportunity(null, '2026-11-25', true)
  expect(first.show).toBe(false)
  const second = recordSponsorOpportunity(first.history, '2026-11-25', true)
  expect(second.show).toBe(true)
  expect(recordSponsorOpportunity(second.history, '2026-11-25', true).show).toBe(false)
  expect(recordSponsorOpportunity(second.history, '2026-11-26', true).show).toBe(true)
})

test('an offline session counts without using the daily placement', () => {
  const first = recordSponsorOpportunity(null, '2026-11-25', false)
  const second = recordSponsorOpportunity(first.history, '2026-11-25', false)
  expect(second.show).toBe(false)
  expect(recordSponsorOpportunity(second.history, '2026-11-25', true).show).toBe(true)
})

test('invalid local history does not make a first session eligible', () => {
  expect(recordSponsorOpportunity({ completed: '2' }, '2026-11-25', true).show).toBe(false)
})

test('setting the clock back cannot undo the daily limit', () => {
  const history = { completed: 2, lastShownOn: '2026-11-26' }
  expect(recordSponsorOpportunity(history, '2026-11-25', true).show).toBe(false)
})
