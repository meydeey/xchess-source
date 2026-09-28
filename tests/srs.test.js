import { describe, test, expect } from 'bun:test'
import { INTERVALS, DAY, statusOf, recordRun, pickNext, localDateStr } from '../src/core/srs.js'

describe('statusOf', () => {
  test('sans entrée : nouvelle', () => {
    expect(statusOf({}, 'a')).toBe('new')
  })
  test('dernière faute présente : à revoir', () => {
    expect(statusOf({ a: { box: 2, due: 0, lastErrors: 1, runs: 3 } }, 'a')).toBe('review')
  })
  test('sans faute, boîte 1 ou 2 : en cours d\'apprentissage', () => {
    expect(statusOf({ a: { box: 1, due: 0, lastErrors: 0, runs: 1 } }, 'a')).toBe('learning')
    expect(statusOf({ a: { box: 2, due: 0, lastErrors: 0, runs: 2 } }, 'a')).toBe('learning')
  })
  test('sans faute, boîte 3 ou plus : maîtrisée', () => {
    expect(statusOf({ a: { box: 3, due: 0, lastErrors: 0, runs: 3 } }, 'a')).toBe('mastered')
  })
})

describe('recordRun', () => {
  const now = 1_000_000

  test('sans faute : avance d\'une boîte, échéance = now + intervalle de la nouvelle boîte', () => {
    const progress = recordRun({}, 'a', 0, now)
    expect(progress.a.box).toBe(1)
    expect(progress.a.due).toBe(now + INTERVALS[1])
    expect(progress.a.lastErrors).toBe(0)
    expect(progress.a.runs).toBe(1)
  })

  test('sans faute répété à chaque échéance : continue à avancer, plafonné à la dernière boîte', () => {
    let progress = {}
    let t = now
    for (let i = 0; i < INTERVALS.length + 2; i++) {
      progress = recordRun(progress, 'a', 0, t)
      t = progress.a.due
    }
    expect(progress.a.box).toBe(INTERVALS.length - 1)
    expect(progress.a.runs).toBe(INTERVALS.length + 2)
  })

  test('avec faute : retombe en boîte 1, échéance immédiate', () => {
    const seeded = recordRun({}, 'a', 0, now)
    const progress = recordRun(seeded, 'a', 2, now + 500)
    expect(progress.a.box).toBe(1)
    expect(progress.a.due).toBe(now + 500)
    expect(progress.a.lastErrors).toBe(2)
    expect(progress.a.runs).toBe(2)
  })

  test('ne modifie pas la map reçue (immutable)', () => {
    const before = {}
    recordRun(before, 'a', 0, now)
    expect(before).toEqual({})
  })

  test('n\'affecte pas les autres lignes', () => {
    const progress = recordRun({ b: { box: 3, due: 5, lastErrors: 0, runs: 4 } }, 'a', 0, now)
    expect(progress.b).toEqual({ box: 3, due: 5, lastErrors: 0, runs: 4 })
  })
})

// Maîtrise (spec V2, L0 point 5) : seul un rappel DÛ, sans fiche montrée avant la tentative ni indice,
// fait monter la boîte. Un passage réussi hors échéance, ou aidé, laisse boîte et échéance en place.
describe('recordRun : seul un rappel dû et sans aide fait progresser', () => {
  const t0 = new Date('2026-09-21T10:00:00').getTime()
  const MIN = 60000

  test('3 passages sans faute à 1 ms d\'écart : la ligne reste en boîte 1', () => {
    let progress = recordRun({}, 'a', 0, t0)
    progress = recordRun(progress, 'a', 0, t0 + 1)
    progress = recordRun(progress, 'a', 0, t0 + 2)
    expect(progress.a.box).toBe(1)
    expect(statusOf(progress, 'a')).toBe('learning')
  })

  test('3 passages sans faute le même jour, même espacés : hors de mastered', () => {
    let progress = recordRun({}, 'a', 0, t0)
    progress = recordRun(progress, 'a', 0, t0 + 11 * MIN) // dû (boîte 1, 10 min) : boîte 2
    progress = recordRun(progress, 'a', 0, t0 + 8 * 3600000) // pas dû (boîte 2, 1 jour)
    expect(progress.a.box).toBe(2)
    expect(statusOf(progress, 'a')).not.toBe('mastered')
  })

  test('un passage réussi hors échéance garde la boîte et l\'échéance', () => {
    const seeded = { a: { box: 2, due: t0 + DAY, lastErrors: 0, runs: 2, flawless: 2, days: [], introduced: '2026-09-21', weak: [] } }
    const progress = recordRun(seeded, 'a', 0, t0 + 3600000)
    expect(progress.a.box).toBe(2)
    expect(progress.a.due).toBe(t0 + DAY)
    expect(progress.a.runs).toBe(3)
    expect(progress.a.flawless).toBe(3)
  })

  test('1 passage dû mais précédé d\'une fiche (aided) : pas de progression, hors de mastered', () => {
    const seeded = { a: { box: 2, due: t0, lastErrors: 0, runs: 2, flawless: 2, days: [], introduced: '2026-09-21', weak: [4] } }
    const progress = recordRun(seeded, 'a', 0, t0 + 1, { aided: true })
    expect(progress.a.box).toBe(2)
    expect(progress.a.due).toBe(t0)
    expect(statusOf(progress, 'a')).toBe('learning')
  })

  test('un rappel dû sans aide 1 jour plus tard fait progresser, pas 1 ms avant (bornes de 24 h)', () => {
    let progress = recordRun({}, 'a', 0, t0)
    const t1 = t0 + 11 * MIN
    progress = recordRun(progress, 'a', 0, t1) // boîte 2, dû à t1 + 24 h
    const early = recordRun(progress, 'a', 0, t1 + DAY - 1)
    expect(early.a.box).toBe(2)
    expect(statusOf(early, 'a')).toBe('learning')
    const onTime = recordRun(progress, 'a', 0, t1 + DAY)
    expect(onTime.a.box).toBe(3)
    expect(statusOf(onTime, 'a')).toBe('mastered')
  })

  test('une faute compte toujours, due ou non : boîte 1, échéance immédiate', () => {
    const seeded = { a: { box: 3, due: t0 + 3 * DAY, lastErrors: 0, runs: 4, flawless: 4, days: [], introduced: '2026-09-21', weak: [] } }
    const progress = recordRun(seeded, 'a', 1, t0)
    expect(progress.a.box).toBe(1)
    expect(progress.a.due).toBe(t0)
  })

  test('ligne neuve : boîte 1 même si le passage était aidé (Découvrir précède toujours le 1er rappel)', () => {
    const progress = recordRun({}, 'a', 0, t0, { aided: true })
    expect(progress.a.box).toBe(1)
    expect(progress.a.due).toBe(t0 + INTERVALS[1])
  })
})

describe('recordRun : statistiques (flawless, lastRun, days, introduced)', () => {
  const now = new Date('2026-09-21T10:00:00').getTime()

  test('premier run sans faute : flawless à 1, introduced et days au jour de ce run', () => {
    const progress = recordRun({}, 'a', 0, now)
    expect(progress.a.flawless).toBe(1)
    expect(progress.a.lastRun).toBe(now)
    expect(progress.a.introduced).toBe('2026-09-21')
    expect(progress.a.days).toEqual(['2026-09-21'])
  })

  test('premier run fauté : flawless reste à 0, introduced est quand même daté (ligne vue)', () => {
    const progress = recordRun({}, 'a', 2, now)
    expect(progress.a.flawless).toBe(0)
    expect(progress.a.introduced).toBe('2026-09-21')
  })

  test('flawless cumule tous les runs sans faute, jamais remis à 0 par une faute ultérieure', () => {
    let progress = recordRun({}, 'a', 0, now)
    progress = recordRun(progress, 'a', 0, now + 1000)
    progress = recordRun(progress, 'a', 3, now + 2000) // faute : box retombe, flawless ne bouge pas
    expect(progress.a.flawless).toBe(2)
    expect(progress.a.runs).toBe(3)
    expect(progress.a.box).toBe(1)
  })

  test('introduced ne change plus après le premier run, même bien plus tard', () => {
    let progress = recordRun({}, 'a', 0, now)
    progress = recordRun(progress, 'a', 0, now + 30 * DAY)
    expect(progress.a.introduced).toBe('2026-09-21')
  })

  test('days accumule les jours distincts des runs, dans l\'ordre, sans doublon le même jour', () => {
    let progress = recordRun({}, 'a', 0, now) // 21
    progress = recordRun(progress, 'a', 0, now + 3 * 3600000) // toujours le 21
    progress = recordRun(progress, 'a', 1, now + DAY) // 22
    expect(progress.a.days).toEqual(['2026-09-21', '2026-09-22'])
  })

  test('days plafonne aux 90 derniers jours distincts, les plus anciens sortent d\'abord', () => {
    let progress = { a: { box: 1, due: 0, lastErrors: 0, runs: 90, flawless: 90, lastRun: now, introduced: '2026-01-01', days: Array.from({ length: 90 }, (_, i) => localDateStr(now + i * DAY)) } }
    progress = recordRun(progress, 'a', 0, now + 90 * DAY)
    expect(progress.a.days.length).toBe(90)
    expect(progress.a.days[0]).toBe(localDateStr(now + 1 * DAY)) // le plus ancien jour est sorti
    expect(progress.a.days.at(-1)).toBe(localDateStr(now + 90 * DAY))
  })

  test('rétrocompatible : une entrée existante sans flawless/days/introduced ne plante pas et reçoit des valeurs saines', () => {
    const legacy = { a: { box: 2, due: now - 1000, lastErrors: 0, runs: 3 } } // format d'avant ce chantier
    const progress = recordRun(legacy, 'a', 0, now)
    expect(progress.a.flawless).toBe(1) // repart de 0, pas d'historique à récupérer
    expect(progress.a.runs).toBe(4) // le compteur d'avant, lui, est bien préservé
    expect(progress.a.days).toEqual(['2026-09-21'])
    expect(progress.a.introduced).toBe('2026-09-21')
  })
})

describe('recordRun : champ weak (chantier X2, rétrocompatible)', () => {
  const now = 1_000_000

  test('sans entrée précédente : weak vaut [] (rien géré par recordRun lui-même)', () => {
    const progress = recordRun({}, 'a', 0, now)
    expect(progress.a.weak).toEqual([])
  })

  test('weak posé par l\'appelant sur progress[lineId] AVANT recordRun : porté tel quel dans l\'entrée', () => {
    const seeded = { a: { box: 1, due: 0, lastErrors: 1, runs: 1, weak: [3, 5] } }
    const progress = recordRun(seeded, 'a', 0, now)
    expect(progress.a.weak).toEqual([3, 5])
  })

  test('un run qui ne touche pas weak le laisse identique d\'un passage à l\'autre', () => {
    let progress = { a: { box: 1, due: 0, lastErrors: 1, runs: 1, weak: [7] } }
    progress = recordRun(progress, 'a', 0, now)
    progress = recordRun(progress, 'a', 0, now + 1000)
    expect(progress.a.weak).toEqual([7])
  })

  test('entrée existante sans weak (créée avant ce chantier) : reçoit un tableau vide', () => {
    const legacy = { a: { box: 2, due: now - 1000, lastErrors: 0, runs: 3 } }
    const progress = recordRun(legacy, 'a', 0, now)
    expect(progress.a.weak).toEqual([])
  })

  test('(progress, lineId, errors, now) suffisent : le 5e paramètre { aided } est facultatif', () => {
    const progress = recordRun({}, 'a', 0, now) // pas de paramètre weak : ne plante pas
    expect(progress.a.runs).toBe(1)
  })

  // Piège documenté (bug réel corrigé dans src/ui/trainer.js et src/ui/session.js, chantier X2) :
  // patcher `weak` dans l'entrée AVANT d'appeler recordRun, sur une ligne qui n'a encore AUCUNE
  // entrée, crée une entrée PARTIELLE ({ weak } seul) que recordRun prend alors pour une entrée
  // EXISTANTE incomplète au lieu de retomber sur ses propres défauts (`prev.runs` undefined + 1 =
  // NaN). La correction : toujours appeler recordRun avec l'entrée précédente INTACTE, et patcher
  // `weak` dans le RÉSULTAT, jamais dans l'entrée passée en argument.
  test('piège : un prev partiel (seulement weak) casse runs -> ne jamais patcher AVANT recordRun', () => {
    const partialPrev = { a: { weak: [4] } } // ce qu'un patch fait AVANT recordRun produirait à tort
    const progress = recordRun(partialPrev, 'a', 1, now)
    expect(Number.isNaN(progress.a.runs)).toBe(true) // documente le piège, pas un comportement voulu
  })
  test('le bon geste : patcher weak dans le RÉSULTAT de recordRun donne un runs correct', () => {
    const next = recordRun({}, 'a', 1, now) // prev intact (ligne neuve, aucune entrée)
    const patched = { ...next, a: { ...next.a, weak: [4] } }
    expect(patched.a.runs).toBe(1)
    expect(patched.a.weak).toEqual([4])
  })
})

describe('localDateStr', () => {
  test('date locale AAAA-MM-JJ, mois et jour sur 2 chiffres', () => {
    expect(localDateStr(new Date('2026-01-05T23:00:00').getTime())).toBe('2026-01-05')
    expect(localDateStr(new Date('2026-09-21T00:00:01').getTime())).toBe('2026-09-21')
  })
})

describe('pickNext', () => {
  const lines = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const now = 1_000_000

  test('privilégie une ligne à revoir (échec) sur une simple ligne due', () => {
    const progress = {
      a: { box: 2, due: now - 10, lastErrors: 0, runs: 2 }, // due, apprise
      b: { box: 1, due: now - 5, lastErrors: 3, runs: 1 }, // due, à revoir
    }
    expect(pickNext(lines, progress, { now }).id).toBe('b')
  })

  test('entre 2 lignes à revoir, la plus ancienne échéance d\'abord', () => {
    const progress = {
      a: { box: 1, due: now - 5, lastErrors: 1, runs: 1 },
      b: { box: 1, due: now - 50, lastErrors: 1, runs: 1 },
    }
    expect(pickNext(lines, progress, { now }).id).toBe('b')
  })

  test('aucune ligne due : la première ligne neuve, dans l\'ordre de l\'arbre', () => {
    const progress = { a: { box: 3, due: now + 10000, lastErrors: 0, runs: 5 } }
    expect(pickNext(lines, progress, { now }).id).toBe('b')
  })

  test('tout a déjà une entrée, rien de due : l\'échéance la plus proche', () => {
    const progress = {
      a: { box: 3, due: now + 5000, lastErrors: 0, runs: 5 },
      b: { box: 3, due: now + 1000, lastErrors: 0, runs: 5 },
      c: { box: 3, due: now + 9000, lastErrors: 0, runs: 5 },
    }
    expect(pickNext(lines, progress, { now }).id).toBe('b')
  })

  test('n\'écarte la ligne courante que s\'il en reste une autre', () => {
    const progress = {}
    expect(pickNext(lines, progress, { now, currentId: 'a' }).id).not.toBe('a')
    expect(pickNext([{ id: 'a' }], {}, { now, currentId: 'a' }).id).toBe('a')
  })

  test('lot vide : null', () => {
    expect(pickNext([], {}, { now })).toBeNull()
  })
})
