const titles = [
  'Un coup d’avance', 'La Diagonale', 'En réserve', 'Le Centre', 'La Case faible',
  'Trait aux Blancs', 'La Tour silencieuse', 'Le Cavalier de nuit', 'Dernière Case', 'La Partie d’après',
]

export const MUSIC_TRACKS = titles.map((title, index) => ({
  title,
  url: `/music/${String(index + 1).padStart(2, '0')}.mp3`,
}))

async function fetchAudio(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Music asset unavailable')
  return response.arrayBuffer()
}

export function createMusic({ openAudio, fetchTrack = fetchAudio, random = Math.random }) {
  const listeners = new Set()
  let state = { index: 0, status: 'paused' }
  let request = null
  let currentSource = null
  let offset = 0
  let buffer = null
  let queue = []

  function update(status, index = state.index) {
    state = { index, status }
    for (const listener of listeners) listener(state)
  }

  function stop(keepOffset = false) {
    request?.abort()
    request = null
    if (!currentSource) return
    const { node, context, startedAt } = currentSource
    if (keepOffset) offset += context.currentTime - startedAt
    currentSource = null
    node.onended = null
    node.stop()
    node.disconnect()
  }

  async function play() {
    if (request || currentSource) return
    const pending = new AbortController()
    request = pending
    update('loading')
    try {
      const [context, bytes] = await Promise.all([
        openAudio(),
        buffer ? null : fetchTrack(MUSIC_TRACKS[state.index].url, pending.signal),
      ])
      if (pending.signal.aborted) return
      const decoded = buffer ?? await context.decodeAudioData(bytes)
      if (pending.signal.aborted) return
      buffer = decoded
      const node = context.createBufferSource()
      node.buffer = buffer
      node.connect(context.destination)
      node.onended = () => {
        if (currentSource?.node !== node) return
        node.disconnect()
        currentSource = null
        return next()
      }
      node.start(0, offset < buffer.duration ? offset : 0)
      currentSource = { node, context, startedAt: context.currentTime }
      update('playing')
    } catch {
      if (!pending.signal.aborted) update('error')
    } finally {
      if (request === pending) request = null
    }
  }

  function select(index, autoplay = true) {
    if (!MUSIC_TRACKS[index]) return
    stop()
    offset = 0
    buffer = null
    queue = queue.filter(item => item !== index)
    update('paused', index)
    if (autoplay) return play()
  }

  function next() {
    if (!queue.length) {
      queue = MUSIC_TRACKS.map((_, index) => index).filter(index => index !== state.index)
      for (let tail = queue.length - 1; tail > 0; tail--) {
        const other = Math.floor(random() * (tail + 1))
        const saved = queue[tail]
        queue[tail] = queue[other]
        queue[other] = saved
      }
    }
    return select(queue.pop(), state.status !== 'paused')
  }

  return {
    get state() { return state },
    toggle() {
      if (state.status !== 'playing' && state.status !== 'loading') return play()
      stop(true)
      update('paused')
    },
    select,
    next,
    subscribe(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
  }
}
