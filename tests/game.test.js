import { describe, test, expect } from 'bun:test'
import {
  hashStr, createRng, addDays, newEvent, sortEvents, comboMultiplier, moveXp, lineBonuses,
  xpForLevel, levelOf, titleOf, streakOf, generateQuests, questLabel, questProgress, chestReward,
  dailyPick, achievementsOf, historyFromProgress, deriveGame, questContext, recallProbability,
  openingMemory, rushPositions, drawRush, rushXp, FREEZE_MAX, ACHIEVEMENTS,
} from '../src/core/game.js'
import { ACHIEVEMENT_ICONS, TIER_ICONS } from '../src/ui/achievement-visuals.js'
import { flagForReview, DAY, localDateStr } from '../src/core/srs.js'

const T0 = new Date('2026-09-22T10:00:00').getTime()
const at = (days, hours = 10, minutes = 0) => new Date(2026, 8, 22 + days, hours, minutes).getTime()
const line = (days, data, xp = 10, hours = 10) => ({ ...newEvent('line', { at: at(days, hours), xp, data: { o: 'caro', l: 'x', ph: 'due', err: 0, combo: 0, ms: 60000, ...data } }) })
const META = {
  caro: { side: 'black', eco: 'B10', name: 'Caro-Kann Defense' },
  anglaise: { side: 'white', eco: 'A10', name: 'English Opening' },
  elephant: { side: 'black', eco: 'C40', name: 'Elephant Gambit' },
}
const meta = (id) => META[id] ?? null

test('chaque trophée a un symbole et les 3 paliers ont une médaille', () => {
  expect(Object.keys(ACHIEVEMENT_ICONS).sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort())
  expect(Object.values(ACHIEVEMENT_ICONS).every(Boolean)).toBe(true)
  expect(TIER_ICONS).toHaveLength(3)
})

describe('hasard reproductible et dates', () => {
  test('même graine, même suite ; graines différentes, suites différentes', () => {
    const a = createRng('x'); const b = createRng('x'); const c = createRng('y')
    const sa = [a(), a(), a()]
    expect([b(), b(), b()]).toEqual(sa)
    expect([c(), c(), c()]).not.toEqual(sa)
    expect(sa.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(hashStr('abc')).toBe(hashStr('abc'))
  })
  test('addDays traverse les mois et le changement d\'heure', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('XP, combo et niveaux', () => {
  test('paliers de combo et XP par coup', () => {
    expect([0, 9, 10, 24, 25, 49, 50].map(comboMultiplier)).toEqual([1, 1, 1.5, 1.5, 2, 2, 3])
    expect(moveXp(1)).toBe(1)
    expect(moveXp(10)).toBe(2)
    expect(moveXp(30, 2)).toBe(4)
  })
  test('bonus de ligne : neuve, sans faute, à l\'heure, maîtrisée, mat', () => {
    const sum = (p) => p.reduce((s, x) => s + x.xp, 0)
    expect(sum(lineBonuses({ phase: 'new', errors: 0 }))).toBe(10)
    expect(sum(lineBonuses({ phase: 'due', errors: 0, becameMastered: true, checkmate: true }))).toBe(35)
    expect(sum(lineBonuses({ phase: 'due', errors: 2 }))).toBe(0)
    expect(sum(lineBonuses({ phase: 'extra', errors: 0 }))).toBe(5)
  })
  test('niveaux quadratiques et titres par tranche de 5', () => {
    expect([1, 2, 3, 10].map(xpForLevel)).toEqual([0, 50, 150, 2250])
    expect(levelOf(0).level).toBe(1)
    expect(levelOf(49).level).toBe(1)
    expect(levelOf(50).level).toBe(2)
    const l = levelOf(200)
    expect(l.level).toBe(3)
    expect(l.into).toBe(50)
    expect(l.span).toBe(150)
    expect(l.nextTitle).toEqual({ level: 5, title: 'Cavalier' })
    expect([1, 4, 5, 9, 10, 50, 80].map(titleOf)).toEqual(['Pion', 'Pion', 'Cavalier', 'Cavalier', 'Fou', 'Légende XChess', 'Légende XChess'])
  })
})

describe('série et gels', () => {
  const days = (...ks) => new Set(ks.map((k) => localDateStr(at(k))))
  const today = localDateStr(at(0))
  test('jours consécutifs, aujourd\'hui pas encore joué : la série tient', () => {
    const s = streakOf(days(-3, -2, -1), { today })
    expect(s.current).toBe(3)
    expect(s.atRisk).toBe(true)
    expect(s.todayActive).toBe(false)
  })
  test('un jour manqué sans gel casse la série', () => {
    expect(streakOf(days(-4, -3, -1, 0), { today }).current).toBe(2)
  })
  test('7 jours de série donnent un gel, qui sauve le jour manqué suivant', () => {
    const s = streakOf(days(-9, -8, -7, -6, -5, -4, -3, -1, 0), { today })
    expect(s.current).toBe(9)
    expect(s.frozen).toEqual([localDateStr(at(-2))])
    expect(s.freezes).toBe(0)
    expect(s.best).toBe(9)
  })
  test('gels plafonnés, gel du coffre utilisable dès le lendemain', () => {
    const long = new Set(Array.from({ length: 30 }, (_, i) => localDateStr(at(-30 + i))))
    expect(streakOf(long, { today }).freezes).toBe(FREEZE_MAX)
    const grants = new Map([[localDateStr(at(-2)), 1]])
    const s = streakOf(days(-3, -2, 0), { today, grants })
    expect(s.current).toBe(3)
    expect(s.frozen).toEqual([localDateStr(at(-1))])
  })
})

describe('défis du jour', () => {
  const day = '2026-09-22'
  test('reproductibles, 3 niveaux, sans 2 fois le même défi', () => {
    for (let k = 0; k < 60; k++) {
      const d = addDays(day, k)
      const ctx = { dueCount: k % 3, newAvailable: 2, bestCombo: 18, rushReady: k % 2 === 0, pick: 'elephant', weakSide: 'white' }
      const a = generateQuests(d, ctx)
      expect(generateQuests(d, ctx)).toEqual(a)
      expect(a.map((q) => q.level)).toEqual(['easy', 'medium', 'hard'])
      expect(a[1].kind).not.toBe(a[2].kind)
      expect(new Set(a.map((q) => q.id)).size).toBe(3)
      for (const q of a) expect(q.target).toBeGreaterThan(0)
    }
  })
  test('les révisions dues passent en premier', () => {
    expect(generateQuests(day, { dueCount: 9 })[0]).toMatchObject({ kind: 'due', target: 5 })
    expect(generateQuests(day, { dueCount: 0, newAvailable: 2 })[0]).toMatchObject({ kind: 'fresh', target: 2 })
    expect(generateQuests(day, {})[0]).toMatchObject({ kind: 'lines', target: 2 })
  })
  test('le parcours propose des exercices et une position personnelle seulement si elle est due', () => {
    expect(generateQuests(day, { challengeFocus: 'foundations', personalDue: 0 }).map((q) => q.kind)).toEqual(['lines', 'puzzles', 'newPuzzle'])
    expect(generateQuests(day, { challengeFocus: 'club', personalDue: 2 }).map((q) => q.kind)).toEqual(['lines', 'puzzles', 'drills'])
  })
  test('libellés au pluriel et au singulier', () => {
    expect(questLabel({ kind: 'due', target: 1 })).toBe("Révise 1 ligne à l'heure")
    expect(questLabel({ kind: 'fresh', target: 3 })).toBe('Apprends 3 nouvelles lignes')
    expect(questLabel({ kind: 'pick', target: 1, openingId: 'elephant' }, (id) => META[id].name)).toBe('Joue la découverte du jour : Elephant Gambit')
    expect(questLabel({ kind: 'side', target: 2, side: 'black' })).toBe('Termine 2 lignes avec les Noirs')
  })
  test('progression lue sur les compteurs du jour', () => {
    const ds = { due: 2, fresh: 1, lines: 4, flawless: 3, comboMax: 12, openings: new Set(['elephant']), sides: { white: 1, black: 3 }, xp: 80, rushMax: 9 }
    expect(questProgress({ kind: 'due' }, ds)).toBe(2)
    expect(questProgress({ kind: 'pick', openingId: 'elephant' }, ds)).toBe(1)
    expect(questProgress({ kind: 'side', side: 'white' }, ds)).toBe(1)
    expect(questProgress({ kind: 'rush' }, ds)).toBe(9)
  })
  test('un exercice inédit avec erreur ou indice ne valide pas le défi sans aide', () => {
    const events = [
      newEvent('puzzle', { at: at(0, 8), data: { ref: 'a', result: 'solved', errors: 1 } }),
      newEvent('puzzle', { at: at(0, 9), data: { ref: 'b', result: 'solved', errors: 0, aided: true } }),
      newEvent('puzzle', { at: at(0, 10), data: { ref: 'c', result: 'solved', errors: 0, aided: false } }),
      newEvent('puzzle', { at: at(0, 11), data: { ref: 'c', result: 'solved', errors: 0, aided: false } }),
    ]
    expect(deriveGame(events, { now: at(0, 12) }).today.cleanPuzzles).toBe(1)
  })
})

describe('coffre et découverte du jour', () => {
  test('récompense fixée par le jour, toutes les sortes tirées sur 400 jours', () => {
    expect(chestReward('2026-09-22')).toEqual(chestReward('2026-09-22'))
    const kinds = new Set(Array.from({ length: 400 }, (_, k) => chestReward(addDays('2026-01-01', k)).kind))
    expect(kinds).toEqual(new Set(['xp', 'freeze', 'boost', 'jackpot']))
  })
  test('découverte : reproductible, jamais jouée, 12 coups au plus', () => {
    const openings = [
      { id: 'a', name: 'Elephant Gambit', moves: ['e4', 'e5', 'Nf3', 'd5'] },
      { id: 'b', name: 'Quiet Line', moves: ['d4'] },
      { id: 'c', name: 'Long Gambit', moves: Array(14).fill('x') },
    ]
    expect(dailyPick('2026-09-22', openings)).toBe(dailyPick('2026-09-22', openings))
    for (let k = 0; k < 30; k++) {
      const id = dailyPick(addDays('2026-09-22', k), openings, new Set(['a']))
      expect(id).toBe('b')
    }
    expect(dailyPick('2026-09-22', openings, new Set(['a', 'b']))).toBeNull()
  })
})

describe('trophées', () => {
  test('paliers, cible suivante et XP cumulée', () => {
    const counters = {
      lines: 120, flawless: 0, due: 0, masteredLines: new Set(), streakBest: 0, comboBest: 26, openings: new Set(),
      ecos: new Set(), volumes: new Set(['A', 'B', 'C', 'D', 'E']), gambits: new Set(), rushBest: 0, mates: 0,
      quests: 0, chests: 0, goalDays: 0, sides: { white: 0, black: 0 }, fast: 0, night: 0, early: 1,
    }
    const byId = Object.fromEntries(achievementsOf(counters).map((a) => [a.id, a]))
    expect(byId.lines).toMatchObject({ tier: 2, target: 1000, xp: 75, desc: 'Termine 1000 lignes' })
    expect(byId.combo).toMatchObject({ tier: 2, xp: 75 })
    expect(byId.volumes).toMatchObject({ tier: 1, done: true, xp: 50 })
    expect(byId.early).toMatchObject({ tier: 1, xp: 50 })
    expect(byId.flawless).toMatchObject({ tier: 0, target: 10, xp: 0 })
  })
})

describe('dérivation de l\'état de jeu', () => {
  test('même état quel que soit l\'ordre des événements (20 mélanges)', () => {
    const events = [
      line(-2, { o: 'caro', combo: 12 }, 20),
      line(-1, { o: 'anglaise', ph: 'new', err: 1 }, 8),
      line(0, { o: 'elephant', mate: true, mst: true, l: 'y' }, 30),
      newEvent('rush', { at: at(0, 11), xp: 30, data: { score: 15 } }),
      newEvent('quests', { at: at(0, 9), data: { list: generateQuests('2026-09-22', { bestCombo: 12 }) } }),
    ]
    const ref = deriveGame(events, { now: at(0, 12), meta })
    const rand = createRng('mélange')
    for (let k = 0; k < 20; k++) {
      const shuffled = [...events].sort(() => rand() - 0.5)
      const g = deriveGame(shuffled, { now: at(0, 12), meta })
      expect(g.xp).toBe(ref.xp)
      expect(g.streak).toEqual(ref.streak)
      expect(g.today.quests).toEqual(ref.today.quests)
    }
    expect(ref.streak.current).toBe(3)
    expect(ref.counters.ecos).toEqual(new Set(['B10', 'A10', 'C40']))
    expect(ref.counters.gambits).toEqual(new Set(['elephant']))
    expect(ref.counters.mates).toBe(1)
    expect(ref.counters.masteredLines.size).toBe(1)
    expect(ref.counters.rushBest).toBe(15)
  })
  test('défis relevés : XP ajoutée, coffre disponible puis ouvert', () => {
    const quests = [
      { id: 'q1', level: 'easy', kind: 'lines', target: 2, xp: 15 },
      { id: 'q2', level: 'medium', kind: 'flawless', target: 1, xp: 25 },
      { id: 'q3', level: 'hard', kind: 'xp', target: 30, xp: 40 },
    ]
    const events = [newEvent('quests', { at: at(0, 8), data: { list: quests } }), line(0, {}, 20), line(0, { err: 2 }, 12)]
    const g = deriveGame(events, { now: at(0, 12), meta })
    expect(g.today.quests.every((q) => q.done)).toBe(true)
    expect(g.today.chest.available).toBe(true)
    expect(g.today.xp).toBe(32 + 80)
    const reward = chestReward('2026-09-22')
    const opened = deriveGame([...events, newEvent('chest', { at: at(0, 12), xp: reward.xp, data: { reward } })], { now: at(0, 12), meta })
    expect(opened.today.chest).toEqual({ opened: reward, available: false })
    expect(opened.counters.chests).toBe(1)
  })
  test('défi en cours : progression bornée à la cible, pas de coffre', () => {
    const quests = [{ id: 'q1', level: 'easy', kind: 'lines', target: 3, xp: 15 }]
    const g = deriveGame([newEvent('quests', { at: at(0, 8), data: { list: quests } }), line(0, {})], { now: at(0, 12), meta })
    expect(g.today.quests[0]).toMatchObject({ progress: 1, done: false })
    expect(g.today.chest.available).toBe(false)
  })
  test('reprise de l\'historique : XP comptée, ouvertures déjà jouées non « découvertes »', () => {
    const h = historyFromProgress({ caro: { a: { box: 3, lastErrors: 0, runs: 4, flawless: 3 }, b: { box: 1, lastErrors: 1, runs: 2, flawless: 0 } } })
    expect(h.xp).toBe(3 * 8 + 3 * 3 + 20)
    expect(h.data.openings).toEqual(['caro'])
    const events = [newEvent('history', { at: at(-5), xp: h.xp, data: h.data }), line(0, { o: 'caro' }, 10), line(0, { o: 'elephant' }, 10)]
    const g = deriveGame(events, { now: at(0, 12), meta })
    expect([...g.today.discovered]).toEqual(['elephant'])
    expect(g.counters.openings.size).toBe(2)
  })
  test('trophée Objectif : chaque jour jugé sur l\'objectif de ce jour-là', () => {
    const quests = (days, goal) => newEvent('quests', { at: at(days, 8), data: { list: [], goal } })
    const events = [quests(-2, 30), line(-2, {}, 40), quests(-1, 30), line(-1, {}, 40)]
    expect(deriveGame(events, { now: at(0, 12), goal: 30, meta }).counters.goalDays).toBe(2)
    expect(deriveGame(events, { now: at(0, 12), goal: 200, meta }).counters.goalDays).toBe(2)
  })
  test('reprise datée du 1er janvier 1970 : hors série, ouvertures jouées avant aujourd\'hui', () => {
    const h = newEvent('history', { at: 0, xp: 100, data: { openings: ['caro'] } })
    const g = deriveGame([h], { now: at(0, 12), meta })
    expect(g.streak.current).toBe(0)
    expect(g.firstDay.get('caro') < localDateStr(at(0))).toBe(true)
    expect(g.xp).toBe(100)
  })
  test('jours de la progression antérieure et boost du coffre', () => {
    const legacyDays = new Set([localDateStr(at(-2)), localDateStr(at(-1))])
    const boost = { kind: 'boost', xp: 0, minutes: 15 }
    const g = deriveGame([line(0, {}), newEvent('chest', { at: at(0, 11, 50), data: { reward: boost } })], { now: at(0, 12), legacyDays, meta })
    expect(g.streak.current).toBe(3)
    expect(g.boost).not.toBeNull()
    expect(deriveGame([newEvent('chest', { at: at(0, 11), data: { reward: boost } })], { now: at(0, 12), meta }).boost).toBeNull()
  })
  test('les exercices donnent des XP et maintiennent la série du jour', () => {
    const events = [
      newEvent('puzzle', { at: at(-1), xp: 10, data: { ref: 'p1', result: 'solved' } }),
      newEvent('puzzle', { at: at(0), xp: 3, data: { ref: 'p2', result: 'solved', errors: 1 } }),
      newEvent('puzzle', { at: at(0, 11), xp: 0, data: { ref: 'p3', result: 'failed', errors: 3 } }),
    ]
    const g = deriveGame(events, { now: at(0, 12), meta })
    expect(g.counters.puzzles).toBe(3)
    expect(g.counters.puzzlesSolved).toBe(2)
    expect(g.today.puzzles).toBe(2)
    expect(g.today.xp).toBe(3)
    expect(g.streak.current).toBe(2)
  })
  test('contexte des défis : moyenne des jours actifs, camp le moins joué', () => {
    const events = [line(-1, { o: 'caro', combo: 22 }), line(-1, { o: 'caro' }), line(-3, { o: 'anglaise' })]
    const g = deriveGame(events, { now: at(0, 12), meta })
    const ctx = questContext(g, { today: localDateStr(at(0)), repertoireSides: ['white', 'black'] })
    expect(ctx.avgLines).toBe(1.5)
    expect(ctx.bestCombo).toBe(22)
    expect(ctx.weakSide).toBe('white')
  })
  test('XP du Rush et record', () => {
    expect(rushXp(12, false)).toBe(24)
    expect(rushXp(12, true)).toBe(49)
  })
})

describe('mémoire des lignes', () => {
  test('environ 75 % à l\'échéance de chaque boîte, 12 h de demi-vie après une erreur', () => {
    const now = T0
    const entry = (box, days, lastErrors = 0) => ({ box, lastErrors, lastRun: now - days * DAY })
    expect(recallProbability(entry(3, 3), now)).toBeCloseTo(0.743, 2)
    expect(recallProbability(entry(4, 7), now)).toBeCloseTo(0.751, 2)
    expect(recallProbability(entry(3, 0.5, 1), now)).toBeCloseTo(0.5, 5)
    expect(recallProbability(null, now)).toBeNull()
    expect(recallProbability({ box: 3, lastErrors: 0, due: now }, now)).toBeCloseTo(recallProbability(entry(3, 3), now), 5)
  })
  test('mémoire d\'une ouverture : lignes jouées seulement, plus faible en tête', () => {
    const lines = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const m = openingMemory(lines, { a: { box: 5, lastErrors: 0, lastRun: T0 }, b: { box: 1, lastErrors: 1, lastRun: T0 - DAY } }, T0)
    expect(m.played).toBe(2)
    expect(m.total).toBe(3)
    expect(m.weakest[0].id).toBe('b')
    expect(m.memory).toBeCloseTo((1 + 0.25) / 2, 5)
    expect(openingMemory(lines, {}, T0)).toBeNull()
  })
})

describe('Rush', () => {
  const lines = [
    { id: 'e4 c6 d4 d5', moves: ['e4', 'c6', 'd4', 'd5'], alts: [[], [], [], []] },
    { id: 'e4 c6 Nc3 d5', moves: ['e4', 'c6', 'Nc3', 'd5'], alts: [[], [], [], ['e5']] },
  ]
  test('positions de mon camp, dédoublonnées par début commun, pondérées par l\'oubli', () => {
    const progress = {
      'e4 c6 d4 d5': { box: 5, lastErrors: 0, lastRun: T0, weak: [] },
      'e4 c6 Nc3 d5': { box: 1, lastErrors: 1, lastRun: T0 - 2 * DAY, weak: [3] },
    }
    const pos = rushPositions([{ openingId: 'caro', side: 'black', lines, progress }], T0)
    expect(pos.map((p) => p.ply)).toEqual([1, 3, 3])
    expect(pos[2].alts).toEqual(['e5'])
    expect(pos[2].weight).toBeGreaterThan(pos[1].weight)
    expect(rushPositions([{ openingId: 'caro', side: 'black', lines, progress: {} }], T0)).toEqual([])
  })
  test('tirage pondéré qui évite les positions récentes', () => {
    const pos = [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }]
    const rand = createRng(1)
    for (let k = 0; k < 20; k++) expect(drawRush(pos, rand, new Set(['a'])).key).toBe('b')
    expect(drawRush(pos, rand, new Set(['a', 'b']))).not.toBeNull()
    expect(drawRush([], rand)).toBeNull()
  })
  test('erreur au Rush : ligne due tout de suite, boîte intacte, coup faible', () => {
    const progress = { l: { box: 4, due: T0 + 5 * DAY, lastErrors: 0, weak: [5] } }
    const next = flagForReview(progress, 'l', 3, T0)
    expect(next.l).toMatchObject({ box: 4, due: T0, weak: [3, 5] })
    expect(flagForReview(progress, 'absente', 3, T0)).toBe(progress)
  })
})

describe('journal', () => {
  test('événement daté du jour local, tri stable par (at, id)', () => {
    const e = newEvent('line', { at: T0, xp: 3 })
    expect(e.day).toBe('2026-09-22')
    expect(typeof e.id).toBe('string')
    const a = { id: 'b', at: 1 }; const b = { id: 'a', at: 1 }; const c = { id: 'z', at: 0 }
    expect(sortEvents([a, b, c]).map((x) => x.id)).toEqual(['z', 'a', 'b'])
  })
})
