// Stockfish over UCI for the build tools (Bun). Scores are always centipawns from White's point of
// view; a mate is encoded as ±(100000 - 100 × plies to mate), so |score| > 90000 means forced mate.
// Binary: env SF, else tools/bin/stockfish (installed by tools/fetch-stockfish.sh, git-ignored).
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { openCache } from './cache.mjs'
import { fenKey } from './explorer.mjs'

export const STOCKFISH_PATH = process.env.SF || new URL('../bin/stockfish', import.meta.url).pathname

export class UciEngine {
  constructor(path = STOCKFISH_PATH, { threads = 2, hash = 128 } = {}) {
    if (!existsSync(path)) throw new Error(`Stockfish introuvable (${path}) : lancer tools/fetch-stockfish.sh`)
    this.proc = spawn(path)
    this.buf = ''
    this.listeners = []
    this.options = { threads, hash }
    this.proc.stdout.on('data', (d) => {
      this.buf += d
      let i
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        for (const l of [...this.listeners]) l(line)
      }
    })
  }

  send(cmd) { this.proc.stdin.write(cmd + '\n') }

  waitFor(pred) {
    return new Promise((resolve) => {
      const l = (line) => {
        if (pred(line)) { this.listeners = this.listeners.filter((x) => x !== l); resolve(line) }
      }
      this.listeners.push(l)
    })
  }

  async init() {
    this.send('uci')
    await this.waitFor((l) => l === 'uciok')
    this.send(`setoption name Threads value ${this.options.threads}`)
    this.send(`setoption name Hash value ${this.options.hash}`)
    this.send('isready')
    await this.waitFor((l) => l === 'readyok')
    return this
  }

  // Returns [{ uci, score, mate }] sorted best first for the side to move.
  async analyse(fen, { multipv = 1, depth = 16, movetime = 1200, searchmoves = [] } = {}) {
    const whiteToMove = fen.split(' ')[1] === 'w'
    const lines = {}
    const l = (line) => {
      if (!line.startsWith('info') || !line.includes(' pv ') || line.includes('bound')) return
      const mpv = Number(line.match(/ multipv (\d+)/)?.[1] || 1)
      const cp = line.match(/ score cp (-?\d+)/)
      const mate = line.match(/ score mate (-?\d+)/)
      let score = cp ? Number(cp[1]) : Math.sign(Number(mate[1])) * (100000 - Math.abs(Number(mate[1])) * 100)
      if (!whiteToMove) score = -score
      lines[mpv] = { uci: line.match(/ pv (\S+)/)[1], score, mate: mate ? Number(mate[1]) * (whiteToMove ? 1 : -1) : null }
    }
    this.listeners.push(l)
    this.send(`setoption name MultiPV value ${multipv}`)
    this.send(`position fen ${fen}`)
    const limits = [depth && `depth ${depth}`, movetime && `movetime ${movetime}`].filter(Boolean).join(' ')
    this.send(`go ${limits}${searchmoves.length ? ' searchmoves ' + searchmoves.join(' ') : ''}`)
    await this.waitFor((x) => x.startsWith('bestmove'))
    this.listeners = this.listeners.filter((x) => x !== l)
    return Object.keys(lines).sort((a, b) => a - b).map((k) => lines[k])
  }

  quit() {
    try { this.send('quit') } catch { /* already gone */ }
    setTimeout(() => this.proc.kill(), 500).unref?.()
  }
}

// N engines sharing the CPU, one search each at a time. Same analyse() contract as UciEngine.
export class EnginePool {
  constructor({ path = STOCKFISH_PATH, size = 4, threads = 3, hash = 128 } = {}) {
    this.engines = Array.from({ length: size }, () => new UciEngine(path, { threads, hash }))
    this.idle = []
    this.waiting = []
    this.ready = Promise.all(this.engines.map((e) => e.init())).then(() => { this.idle.push(...this.engines) })
  }

  async analyse(fen, opts) {
    await this.ready
    const engine = this.idle.pop() || (await new Promise((r) => this.waiting.push(r)))
    try {
      return await engine.analyse(fen, opts)
    } finally {
      const next = this.waiting.shift()
      if (next) next(engine)
      else this.idle.push(engine)
    }
  }

  close() { this.engines.forEach((e) => e.quit()) }
}

// Wraps any engine with the shared SQLite cache; the key covers every search parameter.
export function cachedEngine(engine, cache = openCache()) {
  return {
    async analyse(fen, opts = {}) {
      const { multipv = 1, depth = 16, movetime = 1200, searchmoves = [] } = opts
      const k = `${fenKey(fen)}|${multipv}|${depth}|${movetime}|${searchmoves.join(',')}`
      const hit = cache.get('engine', k)
      if (hit) return hit
      const res = await engine.analyse(fen, { multipv, depth, movetime, searchmoves })
      cache.set('engine', k, res)
      return res
    },
  }
}
