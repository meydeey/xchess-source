// Écriture fiable de l'état (spec V2, L0 point 8) : une écriture n'est réussie que si le store la
// confirme (`set` rend true : localStorage accepté sur le web, fichier réellement écrit sur Mac). En
// échec, la dernière valeur de chaque clé reste en attente, onStatus(false) affiche le bandeau
// « Sauvegarde impossible », et une nouvelle tentative part toutes les `retryMs` ms, ou tout de suite
// par retry(), jusqu'à ce que la cause soit levée. Les écritures passent une par une, dans l'ordre.
// `set` et les minuteries s'injectent pour les tests.
export function createPersister({ set, onStatus = () => {}, retryMs = 10000, timers = globalThis } = {}) {
  const pending = new Map()
  let failing = false
  let timer = null
  let chain = Promise.resolve(true)

  function setFailing(next) {
    if (next === failing) return
    failing = next
    onStatus(!failing)
  }
  function scheduleRetry() {
    if (timer == null) timer = timers.setTimeout(() => { timer = null; flush() }, retryMs)
  }
  async function drain() {
    while (pending.size) {
      for (const [key, value] of [...pending]) {
        let ok = false
        try { ok = (await set(key, value)) === true } catch { ok = false }
        if (!ok) { setFailing(true); scheduleRetry(); return false }
        // Une valeur plus récente a pu arriver pendant l'écriture : elle reste en attente.
        if (pending.get(key) === value) pending.delete(key)
      }
    }
    setFailing(false)
    return true
  }
  function flush() {
    chain = chain.then(drain, drain)
    return chain
  }

  return {
    // write(key, value) : rend true une fois cette valeur confirmée, false si elle reste en attente.
    async write(key, value) {
      pending.set(key, value)
      await flush()
      return !pending.has(key)
    },
    retry() {
      if (timer != null) { timers.clearTimeout(timer); timer = null }
      return flush()
    },
    get failing() { return failing },
  }
}
