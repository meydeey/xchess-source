import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BUNDLE_ID = 'com.meydeey.theorie'
const DIRECTORIES = ['Documents', 'Library/Application Support', 'Library/Preferences', 'Library/WebKit']
const execute = (args) => execFileSync('xcrun', ['devicectl', ...args], { encoding: 'utf8', timeout: 60000 })

export function assertUnlocked(device, run = execute) {
  const output = run(['device', 'info', 'lockState', '--device', device, '--json-output', '-'])
  const state = JSON.parse(output).result
  if (state?.passcodeRequired !== false) throw new Error(`Release blocked: unlock iOS device ${device}; no app launch was attempted`)
}

export function inventory(directory, prefix = '') {
  return readdirSync(directory).sort().flatMap((name) => {
    const path = join(directory, name)
    const relative = prefix ? `${prefix}/${name}` : name
    const info = statSync(path)
    if (info.isDirectory()) return inventory(path, relative)
    if (!info.isFile()) throw new Error(`Unsupported backup entry: ${relative}`)
    return [{ path: relative, bytes: info.size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }]
  })
}

// A partial copy never receives a receipt. Keep it for diagnosis, never reuse its destination.
export function backupDevice(device, destination, run = execute) {
  if (existsSync(destination)) throw new Error('Backup destination already exists')
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  for (const source of DIRECTORIES) {
    const target = join(destination, source)
    mkdirSync(target, { recursive: true, mode: 0o700 })
    run(['device', 'copy', 'from', '--device', device, '--domain-type', 'appDataContainer',
      '--domain-identifier', BUNDLE_ID, '--source', source, '--destination', target])
    if (!existsSync(target)) throw new Error(`Backup copy missing: ${source}`)
  }
  const files = inventory(destination)
  if (!files.some((entry) => entry.path.startsWith('Library/WebKit/') && /IndexedDB/.test(entry.path))) {
    throw new Error('Backup blocked: IndexedDB journal was not copied')
  }
  const receipt = { version: 1, bundle: BUNDLE_ID, device, capturedAt: new Date().toISOString(), files }
  writeFileSync(join(destination, 'backup-receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
  return receipt
}

export function verifyBackup(directory) {
  const receipt = JSON.parse(readFileSync(join(directory, 'backup-receipt.json'), 'utf8'))
  if (receipt.version !== 1 || receipt.bundle !== BUNDLE_ID || !receipt.files?.length) throw new Error('Invalid backup receipt')
  const actual = inventory(directory).filter((entry) => entry.path !== 'backup-receipt.json')
  if (JSON.stringify(actual) !== JSON.stringify(receipt.files)) throw new Error('Backup content differs from receipt')
  return receipt
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [action, ...args] = process.argv.slice(2)
    if (action === 'unlocked' && args.length) {
      for (const device of args) assertUnlocked(device)
    } else if (action === 'backup' && args.length === 2) {
      backupDevice(args[0], args[1])
      verifyBackup(args[1])
      console.log(`Verified iOS backup: ${args[1]}`)
    } else if (action === 'verify' && args.length === 1) {
      verifyBackup(args[0])
      console.log('Backup hashes verified')
    } else throw new Error('Usage: ios-release.mjs unlocked <devices...> | backup <device> <new-directory> | verify <directory>')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
