#!/usr/bin/env node
// release-r2-edge.mjs — edge/R2 release metadata generator. Two subcommands:
//   manifest  -> the per-channel pointer manifest.json (the installer reads this)
//   index     -> the per-channel build-history ledger index.json (+ prune list)
// Pure logic, no network. Consumed only by release-r2-publish.sh. Asset names
// come from release-naming.mjs (the shared naming SSOT). NOT related to
// release-validate-manifest.sh (that validates the GitHub-release artifact set).
// See cli/docs/specs/r2-distribution.md §6.
import { existsSync, readFileSync } from 'node:fs'
import { assetName, loadPkg, validateVersionForChannel } from './release-naming.mjs'

const MAX_BUILDS = 500

function die(msg) {
  process.stderr.write(`release-r2-edge: ${msg}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '')
    if (!key || argv[i + 1] === undefined)
      die(`malformed argument near ${argv[i]}`)
    out[key] = argv[i + 1]
  }
  return out
}

function requireArgs(args, keys) {
  for (const k of keys) {
    if (!args[k])
      die(`missing --${k}`)
  }
}

// checksums lines are "<sha256>  <assetName>"
function shaMap(checksumsPath) {
  const map = new Map()
  for (const line of readFileSync(checksumsPath, 'utf8').split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)$/i)
    if (m)
      map.set(m[2], m[1])
  }
  return map
}

function emitManifest(args) {
  requireArgs(args, ['channel', 'version', 'commit', 'build-date', 'base-url', 'checksums'])
  validateVersionForChannel(args.version, args.channel) // dies on mismatch
  const { release, compat } = loadPkg()
  const shas = shaMap(args.checksums)

  const targetLines = release.targets.map((t) => {
    const asset = assetName(release, args.version, t.id)
    const sha = shas.get(asset)
    if (!sha)
      die(`no sha256 for ${asset} in ${args.checksums}`)
    // spaced single-line so the test regex matches and the POSIX installer can sed it
    return `    ${JSON.stringify(t.id)}: { "asset": ${JSON.stringify(asset)}, "sha256": ${JSON.stringify(sha)} }`
  }).join(',\n')

  const head = {
    schema: 1,
    name: release.binName,
    channel: args.channel,
    version: args.version,
    commit: args.commit,
    buildDate: args['build-date'],
    compat: { minDify: compat.minDify, maxDify: compat.maxDify },
    baseUrl: args['base-url'],
  }
  const headLines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')
  process.stdout.write(`{\n${headLines},\n  "targets": {\n${targetLines}\n  }\n}\n`)
}

function emitIndex(args) {
  requireArgs(args, ['current', 'channel', 'version', 'commit', 'build-date'])

  // empty / "-" / missing all mean "no ledger yet" — keeps the bash curl-to-file
  // plumbing correct on the first publish without a separate sentinel arg.
  let current = { schema: 1, channel: args.channel, builds: [] }
  if (args.current !== '-' && existsSync(args.current)) {
    const raw = readFileSync(args.current, 'utf8').trim()
    if (raw && raw !== '-') {
      try {
        current = JSON.parse(raw)
      }
      catch {
        die(`current index at ${args.current} is not valid JSON`)
      }
    }
  }

  const oldDirs = new Set((current.builds ?? []).map(b => b.dir))
  const entry = { version: args.version, commit: args.commit, buildDate: args['build-date'], dir: args.version }
  const kept = (current.builds ?? []).filter(b => b.version !== entry.version)
  const builds = [entry, ...kept].slice(0, MAX_BUILDS)

  const newDirs = new Set(builds.map(b => b.dir))
  const prune = [...oldDirs].filter(d => !newDirs.has(d))

  const index = { schema: 1, channel: args.channel, updated: args['build-date'], builds }
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`)
  for (const dir of prune)
    process.stderr.write(`${dir}\n`)
}

const [cmd, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)
switch (cmd) {
  case 'manifest':
    emitManifest(args)
    break
  case 'index':
    emitIndex(args)
    break
  default:
    die(`unknown subcommand: ${cmd ?? '(none)'} (expected: manifest | index)`)
}
