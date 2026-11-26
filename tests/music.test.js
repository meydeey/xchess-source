import { expect, test } from 'bun:test'
import { createMusic, MUSIC_TRACKS } from '../src/ui/music.js'

function harness() {
  const nodes = []
  const fetched = []
  const context = {
    destination: {},
    currentTime: 0,
    decodeAudioData: async () => ({ duration: 60 }),
    createBufferSource() {
      const node = {
        connect() {},
        disconnect() {},
        start(_when, offset) { this.offset = offset },
        stop() { this.stopped = true },
        onended: null,
      }
      nodes.push(node)
      return node
    },
  }
  const openAudio = async () => context
  const fetchTrack = async (url) => { fetched.push(url); return new ArrayBuffer(1) }
  return { context, nodes, fetched, openAudio, fetchTrack }
}

test('music starts on demand and resumes from pause without fetching again', async () => {
  const h = harness()
  const music = createMusic(h)
  expect(music.state.status).toBe('paused')
  expect(h.fetched).toEqual([])
  await music.toggle()
  expect(music.state.status).toBe('playing')
  h.context.currentTime = 9
  await music.toggle()
  expect(h.nodes[0].stopped).toBe(true)
  await music.toggle()
  expect(h.nodes[1].offset).toBe(9)
  expect(h.fetched).toEqual(['/music/01.mp3'])
})

test('the queue plays every track once before repeating and never repeats at the boundary', async () => {
  const h = harness()
  const music = createMusic({ ...h, random: () => 0 })
  await music.toggle()
  const indices = [music.state.index]
  for (let i = 0; i < MUSIC_TRACKS.length; i++) {
    await music.next()
    expect(music.state.status).toBe('playing')
    indices.push(music.state.index)
  }
  expect(new Set(indices.slice(0, -1)).size).toBe(MUSIC_TRACKS.length)
  expect(indices.at(-1)).not.toBe(indices.at(-2))
  await h.nodes.at(-1).onended()
  expect(music.state.index).not.toBe(indices.at(-1))
})

test('quick selection cancels obsolete audio and errors allow retry', async () => {
  const h = harness()
  let release
  let failed = true
  const music = createMusic({
    ...h,
    async fetchTrack(url) {
      if (url.endsWith('01.mp3')) await new Promise(resolve => { release = resolve })
      if (url.endsWith('02.mp3') && failed) throw new Error('offline')
      return new ArrayBuffer(1)
    },
  })
  const old = music.toggle()
  expect(music.state.status).toBe('loading')
  await music.select(1)
  expect(music.state).toEqual({ index: 1, status: 'error' })
  failed = false
  await music.toggle()
  release()
  await old
  expect(music.state).toEqual({ index: 1, status: 'playing' })
  expect(h.nodes).toHaveLength(1)
})
