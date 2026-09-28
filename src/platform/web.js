// Plateforme web : navigateur nu, sans Tauri. Le store historique reste lisible pour la migration.
import { createJournal } from './journal.js'
import { createEngine } from './tauri.js'
import { queuedEngine } from './engine-queue.js'
import { createWorkerProcess } from './wasm.js'
const PREFIX = 'theorie:'

// get/set sont async pour rester compatibles avec le store Tauri (@tauri-apps/plugin-store, lui
// intrinsèquement async) : l'appelant peut toujours écrire `await platform.store.get(...)`.
async function get (key) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw == null ? null : JSON.parse(raw)
  } catch {
    return null // stockage indisponible (navigation privée, quota, contexte non-navigateur)
  }
}
async function set (key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const platform = {
  kind: 'web',
  store: { get, set },
  journal: createJournal(),
  engine: queuedEngine(createEngine(createWorkerProcess())),
  onMenu: () => () => {}, // enregistrement sans effet ; rend une fonction de désabonnement, elle aussi sans effet
}
