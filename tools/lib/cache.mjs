// Shared on-disk cache for slow calls (Lichess explorer, Stockfish). SQLite in WAL mode so several
// tool processes can read and write it at the same time. File: tools/cache/cache.sqlite (git-ignored).
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DEFAULT_PATH = new URL('../cache/cache.sqlite', import.meta.url).pathname

export function openCache(path = DEFAULT_PATH) {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { create: true })
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;')
  db.exec('CREATE TABLE IF NOT EXISTS kv (ns TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (ns, k))')
  const read = db.query('SELECT v FROM kv WHERE ns = ? AND k = ?')
  const write = db.query('INSERT OR REPLACE INTO kv (ns, k, v) VALUES (?, ?, ?)')
  return {
    get(ns, k) {
      const row = read.get(ns, k)
      return row ? JSON.parse(row.v) : undefined
    },
    set(ns, k, value) {
      write.run(ns, k, JSON.stringify(value))
    },
    close() { db.close() },
  }
}
