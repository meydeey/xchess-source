import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('offline activation completes before a controlled window navigation finishes', async () => {
  const listeners = {}
  let navigationStarted = false
  const sandbox = {
    caches: { keys: async () => [], delete: async () => true },
    self: {
      addEventListener(name, callback) { listeners[name] = callback },
      clients: {
        claim: async () => {},
        matchAll: async () => [{ url: 'http://localhost/#/collection', navigate() { navigationStarted = true; return new Promise(() => {}) } }],
      },
    },
  }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), sandbox)
  let activation
  listeners.activate({ waitUntil(promise) { activation = promise } })
  expect(await Promise.race([activation.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 30))])).toBe(true)
  expect(navigationStarted).toBe(true)
})
