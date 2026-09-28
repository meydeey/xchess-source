import { mergeEvents, sameEvent, validateEvent } from '../core/journal.js'

const DATABASE = 'chessorbit-journal'
const STORE = 'events'

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onerror = () => reject(request.error || new Error('Journal indisponible'))
    request.onsuccess = () => resolve(request.result)
  })
}

export function createJournal() {
  let database
  async function db() {
    database ||= openDatabase()
    try { return await database } catch (error) { database = null; throw error }
  }

  async function all() {
    const database = await db()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).getAll()
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(mergeEvents(request.result))
    })
  }

  async function appendMany(events) {
    const incoming = mergeEvents(events)
    if (!incoming.length) return true
    const database = await db()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      let failure = null
      transaction.oncomplete = () => resolve(true)
      transaction.onabort = () => reject(failure || transaction.error || new Error('Sauvegarde impossible'))
      transaction.onerror = () => { failure ||= transaction.error }
      for (const event of incoming) {
        validateEvent(event)
        const request = store.get(event.id)
        request.onsuccess = () => {
          if (request.result) {
            if (!sameEvent(request.result, event)) {
              failure = new Error(`Événement divergent : ${event.id}`)
              transaction.abort()
            }
          } else store.add(event)
        }
      }
    })
  }

  async function append(event) { return appendMany([event]) }
  async function since(cursor) {
    const events = await all()
    if (!cursor) return events
    const { at, id } = cursor
    return events.filter((event) => event.at > at || (event.at === at && event.id > id))
  }
  return { append, appendMany, all, since }
}
