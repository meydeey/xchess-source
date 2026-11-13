import { test, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { RABBITS, RABBIT_POSES, rabbitAsset } from '../src/core/appearance.js'
import art from '../tools/art/white-rabbit/provenance.json'

test('every requested production pose resolves to existing art included in the offline shell', () => {
  const actual = readdirSync(new URL('../public/companion/', import.meta.url)).filter((name) => name.endsWith('.png')).map((name) => `./companion/${name}`).sort()
  const requested = [...new Set(RABBITS.flatMap((rabbit) => RABBIT_POSES.map((pose) => './' + rabbitAsset(rabbit.id, pose))))].sort()
  expect(requested).toEqual(actual)
  const sandbox = { self: { addEventListener() {} } }
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8') + '\nglobalThis.shell = SHELL', sandbox)
  expect([...sandbox.shell].filter((path) => path.startsWith('./companion/')).sort()).toEqual(actual)
  expect(art.assets.map((asset) => './' + asset.file.replace('public/', '')).sort()).toEqual(actual)
})
