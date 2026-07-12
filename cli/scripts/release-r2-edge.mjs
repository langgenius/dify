#!/usr/bin/env node
// release-r2-edge.mjs — edge/R2 release metadata generator. Two subcommands:
//   manifest  -> the per-channel pointer manifest.json (the installer reads this)
//   index     -> the per-channel build-history ledger index.json
import { existsSync, readFileSync } from 'node:fs'
import { assetName, loadPkg, validateVersionForChannel } from './release-naming.mjs'

function die(msg) {
  process.stderr.write(`release-r2-edge: ${msg}\n`)
  process.exit(1)
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

// checksums lines are "<sha256>  <assetName>"
function shaMap(checksumsPath) {
  const map = new Map()
  for (const line of readFileSync(checksumsPath, 'utf8').split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)$/i)
    if (m) map.set(m[2], m[1])
  }
  return map
}

function emitManifest(args) {
  requireArgs(args, ['channel', 'version', 'commit', 'build-date', 'base-url', 'checksums'])
  validateVersionForChannel(args.version, args.channel)
  const { release, compat } = loadPkg()
  const shas = shaMap(args.checksums)

  const targetLines = release.targets
    .map((t) => {
      const asset = assetName(release, args.version, t.id)
      const sha = shas.get(asset)
      if (!sha) die(`no sha256 for ${asset} in ${args.checksums}`)
      // one target per line: install-r2.sh grep/sed depends on this layout
      return `    ${JSON.stringify(t.id)}: { "asset": ${JSON.stringify(asset)}, "sha256": ${JSON.stringify(sha)} }`
    })
    .join(',\n')

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
  const headLines = Object.entries(head)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n')
  process.stdout.write(`{\n${headLines},\n  "targets": {\n${targetLines}\n  }\n}\n`)
}

// Newline-delimited dir names of binaries that still exist in R2. Absent file =
// no reconciliation (caller could not list); empty file = no survivors.
function loadExistingDirs(path) {
  if (!path || !existsSync(path)) return null
  const set = new Set()
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const d = line.trim()
    if (d) set.add(d)
  }
  return set
}

function emitIndex(args) {
  requireArgs(args, ['current', 'channel', 'version', 'commit', 'build-date'])

  // empty / "-" / missing = no ledger yet (first publish)
  let current = { schema: 1, channel: args.channel, builds: [] }
  if (args.current !== '-' && existsSync(args.current)) {
    const raw = readFileSync(args.current, 'utf8').trim()
    if (raw && raw !== '-') {
      try {
        current = JSON.parse(raw)
      } catch {
        die(`current index at ${args.current} is not valid JSON`)
      }
    }
  }

  const entry = {
    version: args.version,
    commit: args.commit,
    buildDate: args['build-date'],
    dir: args.version,
  }
  const kept = (current.builds ?? []).filter((b) => b.version !== entry.version)
  let builds = [entry, ...kept]

  // Reconcile to binaries that still exist in R2: lifecycle/TTL on the bin prefix
  // is the only deletion mechanism, so the ledger never advertises a build whose
  // binary is gone. The new build is always kept (just uploaded). No count cap.
  const existing = loadExistingDirs(args['existing-dirs'])
  if (existing) builds = builds.filter((b) => b.dir === entry.dir || existing.has(b.dir))

  const index = { schema: 1, channel: args.channel, updated: args['build-date'], builds }
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`)
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
