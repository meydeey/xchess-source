// Point d'entrée plateforme : choisit web ou tauri selon l'environnement d'exécution, une fois pour
// tout le programme. tauri.js est écrit par un autre agent ; import.meta.glob tolère son absence, ce
// qui laisse le build web passer sans lui (spec 14.6).
import { platform as webPlatform } from './web.js'

const tauriModules = import.meta.glob('./tauri.js', { eager: true })

const hasTauri = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ != null
const tauriModule = tauriModules['./tauri.js']

export const platform = hasTauri && tauriModule ? tauriModule.platform : webPlatform
