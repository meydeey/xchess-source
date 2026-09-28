import { describe, test, expect } from 'bun:test'
import { parseInfo, parseBestMove, createMultiPv } from '../src/platform/uci.js'
import {
  ELO_FLOOR, skillLevelFor, depthForLowElo, createEngine, createProcess, withTimeoutKillLate,
} from '../src/platform/tauri.js'

const FEN_WHITE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
const FEN_BLACK = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

describe('parseInfo', () => {
  test('ignore les lignes qui ne sont pas des infos avec pv', () => {
    expect(parseInfo('readyok', true)).toBeNull()
    expect(parseInfo('info depth 16 currmove e2e4 currmovenumber 1', true)).toBeNull()
  })

  test('ignore une simple borne alpha/bêta (upperbound/lowerbound)', () => {
    const line = 'info depth 3 seldepth 3 multipv 1 score cp 25 upperbound nodes 10 nps 1000 time 1 pv e2e4'
    expect(parseInfo(line, true)).toBeNull()
  })

  test('score cp du point de vue des Blancs, trait aux Blancs', () => {
    const line = 'info depth 16 seldepth 20 multipv 1 score cp 34 nodes 123456 nps 987654 time 120 pv e2e4 e7e5'
    expect(parseInfo(line, true)).toEqual({ multipv: 1, uci: 'e2e4', score: 34, mate: null })
  })

  test('score cp inversé quand le trait est aux Noirs (toujours du point de vue des Blancs)', () => {
    const line = 'info depth 16 seldepth 20 multipv 1 score cp 34 nodes 123456 nps 987654 time 120 pv e7e5 e2e4'
    expect(parseInfo(line, false)).toEqual({ multipv: 1, uci: 'e7e5', score: -34, mate: null })
  })

  test('multipv par défaut à 1 quand absent', () => {
    const line = 'info depth 16 score cp 10 nodes 1 nps 1 time 1 pv d2d4'
    expect(parseInfo(line, true)?.multipv).toBe(1)
  })

  test('mat converti en centipions, trait aux Blancs qui matent', () => {
    const line = 'info depth 10 seldepth 12 multipv 1 score mate 3 nodes 500 nps 1000 time 5 pv e2e4 e7e5 f1c4'
    const info = parseInfo(line, true)
    expect(info.score).toBe(100000 - 300)
    expect(info.mate).toBe(3)
  })

  test('mat côté noir : score et mat négatifs du point de vue des Blancs', () => {
    const line = 'info depth 10 seldepth 12 multipv 1 score mate 3 nodes 500 nps 1000 time 5 pv e7e5 e2e4'
    const info = parseInfo(line, false)
    expect(info.score).toBe(-(100000 - 300))
    expect(info.mate).toBe(-3)
  })

  test('mat négatif (le camp au trait se fait mater) reste cohérent', () => {
    const line = 'info depth 10 multipv 1 score mate -2 nodes 1 nps 1 time 1 pv a2a3'
    const info = parseInfo(line, true)
    expect(info.score).toBe(-(100000 - 200))
    expect(info.mate).toBe(-2)
  })
})

describe('parseBestMove', () => {
  test('bestmove simple', () => {
    expect(parseBestMove('bestmove e2e4')).toEqual({ uci: 'e2e4', ponder: null })
  })

  test('bestmove avec ponder', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ uci: 'e2e4', ponder: 'e7e5' })
  })

  test('null sur une ligne qui n\'est pas un bestmove', () => {
    expect(parseBestMove('info depth 1 pv e2e4')).toBeNull()
  })
})

describe('createMultiPv', () => {
  test('accumule et trie plusieurs lignes multipv, meilleur coup en premier', () => {
    const search = createMultiPv(FEN_WHITE)
    search.feed('info depth 16 multipv 2 score cp 10 nodes 1 nps 1 time 1 pv d2d4')
    search.feed('info depth 16 multipv 1 score cp 34 nodes 1 nps 1 time 1 pv e2e4')
    search.feed('info depth 16 multipv 3 score cp -5 nodes 1 nps 1 time 1 pv g1f3')
    expect(search.lines()).toEqual([
      { uci: 'e2e4', score: 34, mate: null },
      { uci: 'd2d4', score: 10, mate: null },
      { uci: 'g1f3', score: -5, mate: null },
    ])
  })

  test('une nouvelle ligne pour le même multipv remplace la précédente (profondeur suivante)', () => {
    const search = createMultiPv(FEN_WHITE)
    search.feed('info depth 10 multipv 1 score cp 20 nodes 1 nps 1 time 1 pv e2e4')
    search.feed('info depth 16 multipv 1 score cp 34 nodes 1 nps 1 time 1 pv e2e4')
    expect(search.lines()).toEqual([{ uci: 'e2e4', score: 34, mate: null }])
  })

  test('respecte le camp au trait de son propre FEN', () => {
    const search = createMultiPv(FEN_BLACK)
    search.feed('info depth 16 multipv 1 score cp 20 nodes 1 nps 1 time 1 pv e7e5')
    expect(search.lines()).toEqual([{ uci: 'e7e5', score: -20, mate: null }])
  })

  test('ignore les lignes sans pv exploitable', () => {
    const search = createMultiPv(FEN_WHITE)
    search.feed('info depth 16 currmove e2e4 currmovenumber 1')
    expect(search.lines()).toEqual([])
  })
})

describe('skillLevelFor', () => {
  test('400 Elo (le cas exact de la spec 14.6) donne Skill Level 0', () => {
    expect(skillLevelFor(400)).toBe(0)
  })

  test('borné à 0 sous 400 Elo', () => {
    expect(skillLevelFor(0)).toBe(0)
  })

  test('borné à 19 au plancher de UCI_Elo (1320)', () => {
    expect(skillLevelFor(ELO_FLOOR)).toBe(19)
  })

  test('juste sous le plancher (1319) reste borné à 19', () => {
    expect(skillLevelFor(1319)).toBe(19)
  })
})

describe('depthForLowElo', () => {
  test('profondeur 1 au plus bas', () => {
    expect(depthForLowElo(0)).toBe(1)
  })

  test('profondeur 5 juste sous le plancher (1319)', () => {
    expect(depthForLowElo(1319)).toBe(5)
  })

  test('profondeur 5 au plancher (1320)', () => {
    expect(depthForLowElo(ELO_FLOOR)).toBe(5)
  })

  test('toujours entre 1 et 5', () => {
    for (const elo of [0, 200, 400, 800, 1000, 1200, 1319]) {
      const d = depthForLowElo(elo)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(5)
    }
  })
})

// Faux sidecar : simule le protocole UCI sans lancer Stockfish, pour vérifier la séquence de
// setoption envoyée par createEngine() plutôt que son effet sur un vrai moteur. `sent` capture
// chaque commande dans l'ordre, y compris entre 2 appels successifs (le bug corrigé : Skill Level
// laissé actif par un bestMove() bas-Elo qui pollue l'analyse() pleine force suivante, cf. le
// vérificateur adversarial, finding high sur src/platform/tauri.js).
// immediate : la réponse est émise pendant send(), avant que sa promesse ne se résolve, comme le
// vrai sidecar sous charge (la ligne peut précéder la réponse IPC de l'écriture).
function createFakeProc({ immediate = false } = {}) {
  const sent = []
  const listeners = new Set()
  function emit(line) {
    for (const l of [...listeners]) l(line)
  }
  function on(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
  function waitFor(pred) {
    return new Promise((resolve) => {
      const off = on((line) => {
        if (pred(line)) {
          off()
          resolve(line)
        }
      })
    })
  }
  async function send(cmd) {
    sent.push(cmd)
    const reply = () => {
      if (cmd === 'uci') emit('uciok')
      else if (cmd === 'isready') emit('readyok')
      else if (cmd.startsWith('go')) {
        emit('info depth 1 seldepth 1 multipv 1 score cp 0 nodes 1 nps 1 time 1 pv e2e4')
        emit('bestmove e2e4')
      }
    }
    if (immediate) reply()
    else setTimeout(reply, 0)
  }
  async function start() { await send('uci') }
  async function kill() {}
  return { sent, send, on, waitFor, start, kill }
}

describe('createEngine, séquence des options UCI envoyées au moteur', () => {
  test('bestMove() bas-Elo désactive UCI_LimitStrength (jamais actif en même temps que Skill Level)', async () => {
    const proc = createFakeProc()
    const engine = createEngine(proc)
    await engine.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { elo: 400 })
    expect(proc.sent).toContain('setoption name UCI_LimitStrength value false')
    expect(proc.sent).not.toContain('setoption name UCI_LimitStrength value true')
    expect(proc.sent).toContain('setoption name Skill Level value 0')
  })

  test('un bestMove() bas-Elo ne pollue pas l\'analyse() pleine force appelée ensuite', async () => {
    const proc = createFakeProc()
    const engine = createEngine(proc)
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    await engine.bestMove(fen, { elo: 400 }) // laisse Skill Level à 0 si jamais réinitialisé
    proc.sent.length = 0 // ne garder que la séquence du prochain appel
    await engine.analyse(fen, { depth: 10 })
    expect(proc.sent).toContain('setoption name Skill Level value 20')
    expect(proc.sent).toContain('setoption name UCI_LimitStrength value false')
    expect(proc.sent).not.toContain('setoption name Skill Level value 0')
  })

  test('analyse() est toujours pleine force même après plusieurs bestMove() bas-Elo', async () => {
    const proc = createFakeProc()
    const engine = createEngine(proc)
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    await engine.bestMove(fen, { elo: 400 })
    await engine.bestMove(fen, { elo: 500 })
    proc.sent.length = 0
    await engine.analyse(fen, { depth: 10 })
    const skillCalls = proc.sent.filter((c) => c.startsWith('setoption name Skill Level'))
    expect(skillCalls).toEqual(['setoption name Skill Level value 20'])
  })

  test('bestMove() pleine force (elo au-dessus du plancher) active UCI_LimitStrength avec UCI_Elo', async () => {
    const proc = createFakeProc()
    const engine = createEngine(proc)
    await engine.bestMove('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { elo: 1600 })
    expect(proc.sent).toContain('setoption name UCI_LimitStrength value true')
    expect(proc.sent).toContain('setoption name UCI_Elo value 1600')
  })
})

describe('withTimeoutKillLate', () => {
  test('rejette au délai puis tue le process si la vraie promesse aboutit plus tard (orphelin sinon)', async () => {
    let killed = false
    const slowSpawn = new Promise((resolve) => {
      setTimeout(() => resolve({ kill: async () => { killed = true } }), 20)
    })
    await expect(withTimeoutKillLate(slowSpawn, 5, 'lancement du sidecar')).rejects.toThrow(/sans réponse/)
    expect(killed).toBe(false) // pas encore : la vraie promesse n'a pas eu le temps d'aboutir
    await new Promise((r) => setTimeout(r, 30))
    expect(killed).toBe(true) // le process tardif est bien tué, jamais laissé filer
  })

  test('résout normalement quand la promesse aboutit avant le délai', async () => {
    const fast = Promise.resolve({ kill: async () => {} })
    await expect(withTimeoutKillLate(fast, 50, 'lancement du sidecar')).resolves.toEqual({ kill: expect.any(Function) })
  })

  test('propage une vraie erreur de spawn (pas un timeout) sans tenter de tuer quoi que ce soit', async () => {
    const failing = Promise.reject(new Error('binaire introuvable'))
    await expect(withTimeoutKillLate(failing, 50, 'lancement du sidecar')).rejects.toThrow('binaire introuvable')
  })
})

// Faux Command.sidecar() : simule le spawn bas niveau (pas le protocole UCI ligne par ligne, déjà
// couvert par createFakeProc plus haut) pour vérifier createProcess() elle-même, dont son
// comportement sur un handshake qui échoue après un spawn réussi (le bug orphelin du vérificateur
// adversarial, finding high sur src/platform/tauri.js : "chaque relance après un échec partiel de
// start() laisse un Stockfish zombie tourner pour le reste de la session, jamais explicitement
// arrêté par l'app"). `scripts[i].respond` décide si le child #i+1 répond 'uciok' à 'uci' ou reste
// muet (simule un sidecar bloqué en lecture sur son entrée standard, cf. commentaire de
// UCI_WAIT_TIMEOUT_MS).
function createFakeCommand(scripts) {
  let dataHandler = () => {}
  let spawnCount = 0
  const kills = []
  return {
    kills,
    stdout: { on(event, fn) { if (event === 'data') dataHandler = fn } },
    async spawn() {
      const behavior = scripts[Math.min(spawnCount, scripts.length - 1)]
      spawnCount += 1
      const pid = spawnCount
      return {
        pid,
        async write(data) {
          if (behavior.respond && data.trim() === 'uci') {
            // Réponse immédiate, avant même la résolution de write() : le cas le plus exigeant,
            // que start() doit tenir en écoutant 'uciok' avant d'envoyer 'uci'.
            queueMicrotask(() => dataHandler('uciok\n'))
          }
          // behavior.respond === false : mutisme complet, simule le canal IPC qui perd la ligne.
        },
        async kill() { kills.push(pid) },
      }
    },
  }
}

// Fait tourner setTimeout à délai nul le temps du test : évite d'attendre les 15 s réelles de
// UCI_WAIT_TIMEOUT_MS pour exercer le chemin de timeout de createProcess().start() sans changer la
// constante de production (calibrée sur des temps réels mesurés, section 5/14.5).
async function withInstantTimers(fn) {
  const real = global.setTimeout
  global.setTimeout = (cb, _ms, ...args) => real(cb, 0, ...args)
  try {
    await fn()
  } finally {
    global.setTimeout = real
  }
}

describe('createProcess, orphelins sur un handshake qui échoue après un spawn réussi', () => {
  test('start() tue le child déjà spawné si uciok n\'arrive jamais, avant de perdre sa référence', () => withInstantTimers(async () => {
    const command = createFakeCommand([{ respond: false }, { respond: true }])
    const proc = createProcess(command)

    await expect(proc.start()).rejects.toThrow()
    // Le vérificateur adversarial : "kill()/dispose() ne tue jamais que le DERNIER process
    // référencé" -- ici le tout premier child, jamais fonctionnel, doit être tué directement par
    // start(), pas seulement par un kill() ultérieur sur un autre process.
    expect(command.kills).toEqual([1])

    // 2e tentative (le chemin exact de ensureReady() après un 1er échec) : un nouveau child est
    // spawné et répond correctement cette fois.
    await proc.start()
    expect(command.kills).toEqual([1]) // le 2e child, fonctionnel, n'est pas tué

    await proc.kill()
    expect(command.kills).toEqual([1, 2]) // le child courant est bien tué à la fin
  }))

  test('2 handshakes ratés de suite ne laissent aucun des 2 children vivant sans trace', () => withInstantTimers(async () => {
    const command = createFakeCommand([{ respond: false }, { respond: false }, { respond: true }])
    const proc = createProcess(command)

    await expect(proc.start()).rejects.toThrow()
    await expect(proc.start()).rejects.toThrow()
    expect(command.kills).toEqual([1, 2]) // les 2 échecs sont chacun tués, aucun zombie cumulé

    await proc.start()
    await proc.kill()
    expect(command.kills).toEqual([1, 2, 3])
  }))
})

// Faux proc pour createEngine() : simule un handshake initial réussi puis un blocage mi-session
// (le scénario exact du rapport d'intégration E4 : Stockfish vivant, bloqué en lecture sur son
// entrée standard pendant un `go`), pour vérifier que le moteur redevient utilisable au PROCHAIN
// appel plutôt que de retimeouter indéfiniment sur le même sidecar figé (finding high : "le filet
// de sécurité... ne rend rien récupérable après le tout premier succès du moteur").
function createFreezableProc() {
  const startCalls = []
  const killCalls = []
  const listeners = new Set()
  let failNextGo = false
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn) }
  function emit(line) { for (const l of [...listeners]) l(line) }
  async function send(cmd) {
    if (cmd.startsWith('go') && failNextGo) {
      failNextGo = false
      throw new Error('Stockfish : go sans réponse après 15000 ms (sidecar figé)')
    }
    // setTimeout(0), pas queueMicrotask : même piège que createFakeProc plus haut, sinon la ligne
    // arrive avant que le waitFor() de l'appelant ait eu la chance de s'enregistrer.
    setTimeout(() => {
      if (cmd === 'isready') emit('readyok')
      else if (cmd.startsWith('go')) {
        emit('info depth 1 seldepth 1 multipv 1 score cp 0 nodes 1 nps 1 time 1 pv e2e4')
        emit('bestmove e2e4')
      }
    }, 0)
  }
  function waitFor(pred) {
    return new Promise((resolve) => {
      const off = on((line) => { if (pred(line)) { off(); resolve(line) } })
    })
  }
  async function start() { startCalls.push(startCalls.length + 1) }
  async function kill() { killCalls.push(killCalls.length + 1) }
  return {
    send, on, waitFor, start, kill,
    startCalls, killCalls,
    listenerCount: () => listeners.size,
    freezeNextGo: () => { failNextGo = true },
  }
}

describe('createEngine, récupération après un blocage mi-session (analyse/bestMove, pas seulement start)', () => {
  const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

  test('un échec d\'analyse() APRÈS le 1er succès respawn au lieu de retimeouter à l\'identique', async () => {
    const proc = createFreezableProc()
    const engine = createEngine(proc)

    const first = await engine.analyse(FEN, { depth: 1 })
    expect(first[0].uci).toBe('e2e4')
    expect(proc.startCalls.length).toBe(1)

    proc.freezeNextGo() // simule le sidecar qui se bloque en plein "go", après un handshake réussi
    await expect(engine.analyse(FEN, { depth: 1 })).rejects.toThrow()
    expect(proc.killCalls.length).toBe(1) // le process figé est tué plutôt que réutilisé

    const third = await engine.analyse(FEN, { depth: 1 })
    expect(third[0].uci).toBe('e2e4')
    expect(proc.startCalls.length).toBe(2) // respawn réel au 3e appel, pas la même promesse résolue
  })

  test('même récupération pour bestMove()', async () => {
    const proc = createFreezableProc()
    const engine = createEngine(proc)

    await engine.bestMove(FEN, { elo: 400 })
    expect(proc.startCalls.length).toBe(1)

    proc.freezeNextGo()
    await expect(engine.bestMove(FEN, { elo: 400 })).rejects.toThrow()
    expect(proc.killCalls.length).toBe(1)

    const move = await engine.bestMove(FEN, { elo: 400 })
    expect(move).toBe('e2e4')
    expect(proc.startCalls.length).toBe(2)
  })

  test('un échec d\'analyse() ne laisse pas d\'écouteur accroché sur proc (fuite cumulative sinon)', async () => {
    const proc = createFreezableProc()
    const engine = createEngine(proc)

    proc.freezeNextGo()
    await expect(engine.analyse(FEN, { depth: 1 })).rejects.toThrow()
    expect(proc.listenerCount()).toBe(0)

    // Un 2e échec ne doit pas non plus en accumuler un de plus.
    proc.freezeNextGo()
    await expect(engine.analyse(FEN, { depth: 1 })).rejects.toThrow()
    expect(proc.listenerCount()).toBe(0)
  })

  test('dispose() réarme aussi ready : un appel après dispose() respawn plutôt que d\'échouer sèchement', async () => {
    const proc = createFreezableProc()
    const engine = createEngine(proc)

    await engine.analyse(FEN, { depth: 1 })
    expect(proc.startCalls.length).toBe(1)

    await engine.dispose()
    expect(proc.killCalls.length).toBe(1)

    const after = await engine.analyse(FEN, { depth: 1 })
    expect(after[0].uci).toBe('e2e4')
    expect(proc.startCalls.length).toBe(2)
  })
})

describe('createEngine, réponse du sidecar plus rapide que la confirmation d\'écriture', () => {
  test('analyse() et bestMove() reçoivent bestmove et readyok émis pendant send()', async () => {
    const engine = createEngine(createFakeProc({ immediate: true }))
    const lines = await engine.analyse(FEN_WHITE, { depth: 1 })
    expect(lines[0].uci).toBe('e2e4')
    expect(await engine.bestMove(FEN_WHITE, { elo: 400 })).toBe('e2e4')
    expect(await engine.bestMove(FEN_WHITE, { elo: 1500 })).toBe('e2e4')
  })
})
