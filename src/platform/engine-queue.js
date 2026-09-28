// File d'attente d'un moteur (spec V2, §5.2 et L0 point 1) : un seul processus Stockfish ne traite
// qu'une recherche à la fois, et 2 demandes envoyées ensemble mélangeaient leurs lignes « info ». Les
// demandes passent donc une par une. Priorité aux demandes interactives (coup adverse, indice) : elles
// doublent toutes les analyses de fond en attente, qui reprennent ensuite. Chaque demande peut porter
// un `signal` (AbortSignal) : annulée avant son tour, elle ne part jamais ; annulée pendant, son
// résultat périmé est jeté. Commun aux adaptateurs (Tauri aujourd'hui, WASM sur iPhone en L4).
export function abortError() {
  const err = new Error('Demande moteur annulée')
  err.name = 'AbortError'
  return err
}

export function createEngineQueue() {
  const waiting = []
  let running = false

  function takeNext() {
    const i = waiting.findIndex((job) => job.priority === 'interactive')
    return waiting.splice(i >= 0 ? i : 0, 1)[0]
  }
  async function pump() {
    if (running) return
    running = true
    try {
      while (waiting.length) {
        const job = takeNext()
        if (job.signal?.aborted) { job.reject(abortError()); continue }
        try {
          const result = await job.run()
          if (job.signal?.aborted) job.reject(abortError())
          else job.resolve(result)
        } catch (err) {
          job.reject(err)
        }
      }
    } finally {
      running = false
    }
  }

  // schedule(run, { priority, signal }) : run() lance la recherche et rend sa promesse ; rend la
  // promesse du résultat. priority : 'interactive' ou 'background' (défaut).
  function schedule(run, { priority = 'background', signal = null } = {}) {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      waiting.push({ run, priority, signal, resolve, reject })
      pump()
    })
  }

  return { schedule, get size() { return waiting.length + (running ? 1 : 0) } }
}

// queuedEngine(engine) : même contrat que platform.engine (analyse, bestMove, dispose), toutes les
// recherches sérialisées par une file. bestMove est interactif par défaut, analyse de fond par défaut ;
// opts.priority et opts.signal changent ce choix pour une demande.
export function queuedEngine(engine) {
  const queue = createEngineQueue()
  return {
    analyse(fen, { priority = 'background', signal = null, ...opts } = {}) {
      return queue.schedule(() => engine.analyse(fen, opts), { priority, signal })
    },
    bestMove(fen, { priority = 'interactive', signal = null, ...opts } = {}) {
      return queue.schedule(() => engine.bestMove(fen, opts), { priority, signal })
    },
    dispose() {
      return engine.dispose()
    },
  }
}
