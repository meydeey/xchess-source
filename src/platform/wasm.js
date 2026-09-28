// Stockfish.js dans un Web Worker. Même contrat UCI que le sidecar Mac, sans accès au shell.
const WAIT_MS = 15000

export function createWorkerProcess(createWorker = () => new Worker(new URL('engine/stockfish-19-lite-single.js', document.baseURI))) {
  let worker = null
  const listeners = new Set()
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

  function waitFor(predicate) {
    return new Promise((resolve, reject) => {
      const off = on((line) => {
        if (!predicate(line)) return
        clearTimeout(timer)
        off()
        resolve(line)
      })
      const timer = setTimeout(() => {
        off()
        reject(new Error('Stockfish Web : aucune réponse du moteur'))
      }, WAIT_MS)
    })
  }

  async function start() {
    if (worker) await kill()
    worker = createWorker()
    let rejectLoad
    const failed = new Promise((_, reject) => { rejectLoad = reject })
    worker.onerror = () => rejectLoad(new Error('Stockfish Web ne peut pas être chargé'))
    worker.onmessage = ({ data }) => {
      if (typeof data !== 'string') return
      for (const line of data.split(/\r?\n/)) if (line.trim()) for (const fn of [...listeners]) fn(line.trim())
    }
    try {
      const reply = waitFor((line) => line === 'uciok')
      reply.catch(() => {})
      worker.postMessage('uci')
      await Promise.race([reply, failed])
      worker.onerror = null
    } catch (error) {
      await kill()
      throw error
    }
  }

  async function send(command) {
    if (!worker) throw new Error('Stockfish Web non démarré')
    worker.postMessage(command)
  }

  async function kill() {
    worker?.terminate()
    worker = null
  }

  return { start, send, on, kill }
}
