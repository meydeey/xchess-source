import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Public source snapshots have their own Git history but retain the original release ID.
const releaseId = existsSync('RELEASE_ID')
  ? readFileSync('RELEASE_ID', 'utf8').trim()
  : execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()

function stampServiceWorker() {
  let outDir
  return {
    name: 'stamp-service-worker-release',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir },
    closeBundle() {
      const path = resolve(outDir, 'sw.js')
      const source = readFileSync(path, 'utf8')
      if (!source.includes('__XCHESS_RELEASE__')) throw new Error('Service worker release marker is missing')
      writeFileSync(path, source.replaceAll('__XCHESS_RELEASE__', releaseId))
    },
  }
}

// Réglages recommandés par Tauri 2 pour un frontend Vite (https://v2.tauri.app/start/frontend/vite/) :
// port de dev fixe et strict (tauri.conf.json pointe devUrl dessus), pas d'écran effacé pour
// garder les erreurs Rust visibles, HMR sur le même port en environnement mobile le cas échéant.
// viteSingleFile reste seul responsable du bundle : le build web (bun run build) passe sans Tauri.
export default defineConfig(async () => ({
  plugins: [viteSingleFile(), stampServiceWorker()],
  define: { __XCHESS_RELEASE__: JSON.stringify(releaseId) },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
}))
