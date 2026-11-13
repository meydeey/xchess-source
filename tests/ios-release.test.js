import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertUnlocked, backupDevice, verifyBackup } from '../tools/lib/ios-release.mjs'

const temporary = () => join(mkdtempSync(join(tmpdir(), 'xchess-backup-')), 'device')
const copy = (args) => {
  const target = args[args.indexOf('--destination') + 1]
  expect(existsSync(target)).toBe(true)
  mkdirSync(target, { recursive: true })
  if (target.endsWith('WebKit')) {
    mkdirSync(join(target, 'IndexedDB'), { recursive: true })
    writeFileSync(join(target, 'IndexedDB', 'journal.sqlite3'), 'synthetic journal')
  }
}

test('checks device lock without trying to launch the expired app', () => {
  const calls = []
  assertUnlocked('ipad', (args) => { calls.push(args); return JSON.stringify({ result: { passcodeRequired: false } }) })
  expect(calls).toHaveLength(1)
  expect(calls[0]).toContain('lockState')
  for (const result of [{ passcodeRequired: true }, {}, { unlockedSinceBoot: true }]) {
    expect(() => assertUnlocked('ipad', () => JSON.stringify({ result }))).toThrow('unlock iOS device')
  }
})

test('copies every persistent directory and verifies file contents', () => {
  const path = temporary()
  const receipt = backupDevice('ipad', path, copy)
  expect(receipt.files.some((f) => f.path.includes('IndexedDB'))).toBe(true)
  expect(verifyBackup(path)).toEqual(receipt)
  writeFileSync(join(path, receipt.files[0].path), 'changed')
  expect(() => verifyBackup(path)).toThrow('differs')
})

test('failed or empty copies cannot authorize an installation', () => {
  const failed = temporary()
  expect(() => backupDevice('ipad', failed, () => { throw new Error('Device locked') })).toThrow('Device locked')
  expect(existsSync(join(failed, 'backup-receipt.json'))).toBe(false)
  const empty = temporary()
  expect(() => backupDevice('ipad', empty, (args) => mkdirSync(args.at(-1), { recursive: true }))).toThrow('journal was not copied')
  expect(existsSync(join(empty, 'backup-receipt.json'))).toBe(false)
})

test('a previous backup is never overwritten', () => {
  const path = temporary()
  backupDevice('ipad', path, copy)
  expect(() => backupDevice('ipad', path, copy)).toThrow('already exists')
})
