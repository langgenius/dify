// release-r2-edge.mjs — edge/R2 release metadata generator. Two subcommands:
//   manifest  -> the per-channel pointer manifest.json (the installer reads this)
//   index     -> the per-channel build-history ledger index.json
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildIndex,
  parseChecksums,
  parseDirList,
  renderManifest,
  resolveTargets,
} from './lib/edge-manifest.mjs'
import { channelVersionProblem } from './lib/release-rules.mjs'
import { loadPkg } from './release-naming.mjs'

class UsageError extends Error {}

// Arrow so TS infers `never`, keeping expression positions like `return die(...)` typed.
const die = (msg) => {
  throw new UsageError(msg)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    const val = argv[i + 1]
    if (!key || val === undefined || val.startsWith('--'))
      die(`malformed argument near ${argv[i]} (expected --key value)`)
    out[key] = val
  }
  return out
}

function requireArgs(args, keys) {
  for (const k of keys) {
    if (!args[k]) die(`missing --${k}`)
  }
}

function emitManifest(args) {
  requireArgs(args, ['channel', 'version', 'commit', 'build-date', 'base-url', 'checksums'])
  const versionProblem = channelVersionProblem(args.version, args.channel)
  if (versionProblem) die(versionProblem)

  const { release, compat } = loadPkg()
  const shas = parseChecksums(readFileSync(args.checksums, 'utf8'))
  const { targets, missing } = resolveTargets(release, args.version, shas)
  if (missing.length > 0) die(`no sha256 for ${missing[0]} in ${args.checksums}`)

  return renderManifest({
    binName: release.binName,
    channel: args.channel,
    version: args.version,
    commit: args.commit,
    buildDate: args['build-date'],
    compat,
    baseUrl: args['base-url'],
    targets,
  })
}

// empty / "-" / missing = no ledger yet (first publish)
function loadCurrentIndex(path) {
  if (path === '-' || !existsSync(path)) return null
  const raw = readFileSync(path, 'utf8').trim()
  if (!raw || raw === '-') return null
  try {
    return JSON.parse(raw)
  } catch {
    return die(`current index at ${path} is not valid JSON`)
  }
}

// Absent file = no reconciliation (caller could not list); empty file = no survivors.
function loadExistingDirs(path) {
  if (!path || !existsSync(path)) return null
  return parseDirList(readFileSync(path, 'utf8'))
}

function emitIndex(args) {
  requireArgs(args, ['current', 'channel', 'version', 'commit', 'build-date'])
  const index = buildIndex({
    channel: args.channel,
    version: args.version,
    commit: args.commit,
    buildDate: args['build-date'],
    current: loadCurrentIndex(args.current),
    existingDirs: loadExistingDirs(args['existing-dirs']),
  })
  return `${JSON.stringify(index, null, 2)}\n`
}

// Returns the exact bytes to write to stdout.
function main(argv) {
  const [cmd, ...rest] = argv
  const args = parseArgs(rest)
  switch (cmd) {
    case 'manifest':
      return emitManifest(args)
    case 'index':
      return emitIndex(args)
    default:
      return die(`unknown subcommand: ${cmd ?? '(none)'} (expected: manifest | index)`)
  }
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    process.stdout.write(main(process.argv.slice(2)))
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    process.stderr.write(`release-r2-edge: ${e.message}\n`)
    process.exit(1)
  }
}

export { main }
