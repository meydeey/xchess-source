import { test, expect } from 'bun:test'
import { readFileSync, statSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const worker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

test('offline installation precaches only existing web assets', async () => {
  let install, skipped = false
  const added = []
  runInNewContext(worker, {
    caches: { open: async () => ({ async addAll(urls) { added.push(...urls) } }) },
    self: {
      addEventListener(name, callback) { if (name === 'install') install = callback },
      skipWaiting() { skipped = true },
    },
  })
  let installed
  install({ waitUntil(promise) { installed = promise } })
  await installed
  expect(skipped).toBe(true)
  expect(added).toContain('./')
  expect(added).toContain('./packs/index.json')
  expect(added).toContain('./engine/stockfish-19-lite-single.wasm')
  expect(added.filter((url) => url.startsWith('./music/'))).toHaveLength(10)
  expect(added.some((url) => url.startsWith('./companion/'))).toBe(false)
  for (const url of added) {
    const path = url === './' ? '../index.html' : `../public/${url.slice(2)}`
    expect(statSync(new URL(path, import.meta.url)).isFile()).toBe(true)
  }
})

test('an unavailable album does not prevent installing the offline application', async () => {
  let install, skipped = false
  runInNewContext(worker, {
    caches: { open: async () => ({ async addAll(urls) { if (urls[0].startsWith('./music/')) throw new Error('offline') } }) },
    self: {
      addEventListener(name, callback) { if (name === 'install') install = callback },
      skipWaiting() { skipped = true },
    },
  })
  let installed
  install({ waitUntil(promise) { installed = promise } })
  await installed
  expect(skipped).toBe(true)
})

test('offline navigation opens the requested support or privacy page', async () => {
  let fetchListener
  const scope = 'https://xchess.example/'
  const entries = new Map([['./', 'application'], ['./support.html', 'support'], ['./privacy.html', 'privacy']])
  runInNewContext(worker, {
    URL,
    caches: { open: async () => ({ match: (key) => entries.get(key) }) },
    fetch: async () => { throw new Error('offline') },
    self: {
      location: new URL(scope),
      registration: { scope },
      addEventListener(name, callback) { if (name === 'fetch') fetchListener = callback },
    },
  })
  const navigate = (path) => new Promise((resolve) => {
    fetchListener({ request: { method: 'GET', mode: 'navigate', url: scope + path }, respondWith: resolve })
  })
  expect(await navigate('support.html#fr')).toBe('support')
  expect(await navigate('privacy.html#pt-BR')).toBe('privacy')
  expect(await navigate('#/settings/help')).toBe('application')
})

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
  runInNewContext(worker, sandbox)
  let activation
  listeners.activate({ waitUntil(promise) { activation = promise } })
  expect(await Promise.race([activation.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 30))])).toBe(true)
  expect(navigationStarted).toBe(true)
})
