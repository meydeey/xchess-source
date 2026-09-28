// Publish a curated source snapshot without the private repository history or notes.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const release = process.argv[2]
const mode = process.argv[3] || '--publish'
if (!/^[0-9a-f]{12}$/.test(release || '') || !['--prepare', '--publish'].includes(mode)) {
  console.error('Usage: bun tools/publish-source.mjs <12-character Git SHA> [--prepare|--publish]')
  process.exit(2)
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
}

function output(command, args, cwd = root) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim()
}

if (output('git', ['rev-parse', '--short=12', 'HEAD']) !== release) throw new Error('Release ID does not match HEAD')
if (output('git', ['status', '--porcelain'])) throw new Error('Commit all changes before publishing source')

const allow = ['src', 'src-tauri', 'public', 'catalog', 'tools', 'tests', 'index.html', 'package.json', 'bun.lock', 'vite.config.js', '.gitignore', 'LICENSE', 'NOTICE.md', 'SOURCE.md', 'THIRD_PARTY_SOURCES.md']
const files = execFileSync('git', ['ls-files', '-z', '--', ...allow], { cwd: root, maxBuffer: 8 * 1024 * 1024 })
  .toString().split('\0').filter(Boolean)
const excluded = files.filter((path) => path.startsWith('docs/') || path.startsWith('supabase/') || path.includes('.infisical') || path.includes('.env') || path.includes('HANDOFF') || path.includes('AGENTS'))
if (excluded.length) throw new Error(`Unsafe source selection: ${excluded.join(', ')}`)

const stage = mkdtempSync(join(tmpdir(), `xchess-source-${release}-`))
for (const path of files) {
  const source = join(root, path)
  if (!lstatSync(source).isFile()) throw new Error(`Non-file in source selection: ${path}`)
  const target = join(stage, path)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}
writeFileSync(join(stage, 'README.md'), `Release: \`${release}\`\n\n${readFileSync(join(root, 'SOURCE.md'), 'utf8')}`)
writeFileSync(join(stage, 'RELEASE_ID'), `${release}\n`)

// Scan our source before adding checksum-verified upstream archives.
run('gitleaks', ['dir', '--no-banner', '--redact', '--log-level', 'error', stage])
run('bun', ['install', '--frozen-lockfile'], stage)
run('bun', ['run', 'build'], stage)
if (!readFileSync(join(stage, 'dist/index.html'), 'utf8').includes(release)) {
  throw new Error('Public source build does not contain the release ID')
}

const archives = [
  ['stockfish.js-v19.0.0.tar.gz', 'https://codeload.github.com/nmrugg/stockfish.js/tar.gz/refs/tags/v19.0.0', '183b576fa9c8610a9be48c6e5b97506502985e64a771e769a16dbecf2f125d54'],
  ['Stockfish-sf_19.tar.gz', 'https://codeload.github.com/official-stockfish/Stockfish/tar.gz/refs/tags/sf_19', '519b653d0d1ffb96531d982ccbe5c6a19425e8388e0e3c2f70f34b424ab32d76'],
  ['chessground-9.2.1.tgz', 'https://registry.npmjs.org/chessground/-/chessground-9.2.1.tgz', '6bcb9f102c05aa1d5e3cfe9eb82338fb79d829cd575b545a6896706b4a06d058'],
]
mkdirSync(join(stage, 'third_party'))
for (const [name, url, expected] of archives) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Source download failed: ${name} (${response.status})`)
  const content = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== expected) throw new Error(`Source checksum mismatch: ${name}`)
  writeFileSync(join(stage, 'third_party', name), content)
}
console.log(`Source snapshot prepared: ${release}, ${files.length} project files, ${stage}`)
if (mode === '--prepare') process.exit(0)

const repo = 'meydeey/xchess-source'
const tag = `xchess-${release}`
const remote = `https://github.com/${repo}.git`
const existing = spawnSync('gh', ['repo', 'view', repo, '--json', 'url'], { cwd: root, stdio: 'ignore' }).status === 0
if (!existing) run('gh', ['repo', 'create', repo, '--public', '--description', 'Public source snapshots for XChess'])

const mirror = join(stage, 'mirror')
run('gh', ['repo', 'clone', repo, mirror, '--', '--quiet'])
if (spawnSync('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], { cwd: mirror, stdio: 'ignore' }).status === 0) {
  console.log(`Public source already exists: https://github.com/${repo}/tree/${tag}`)
  process.exit(0)
}
const prior = output('git', ['ls-files', '-z'], mirror).split('\0').filter(Boolean)
for (const path of prior) {
  const target = join(mirror, path)
  if (existsSync(target)) unlinkSync(target)
}
for (const path of [...files, 'README.md', 'RELEASE_ID', ...archives.map(([name]) => `third_party/${name}`)]) {
  const target = join(mirror, path)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(join(stage, path), target)
}
run('git', ['add', '--all'], mirror)
if (output('git', ['status', '--porcelain'], mirror)) run('git', ['commit', '-m', `release: XChess ${release}`], mirror)
run('git', ['tag', tag], mirror)
run('git', ['push', 'origin', 'HEAD:main'], mirror)
run('git', ['push', 'origin', tag], mirror)
output('gh', ['api', `repos/${repo}/git/ref/tags/${tag}`])
console.log(`Public source: https://github.com/${repo}/tree/${tag}`)
