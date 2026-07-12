#!/usr/bin/env node
// release-naming.mjs — single source of truth for difyctl release artifact
// names and version/channel rules. Reads DATA from cli/package.json
// `difyctl.release` (plus `version` and `difyctl.channel`) and owns the name
// FORMAT and the per-channel version form. Producer scripts call this;
// `validate` is the release gate.
//
// Subcommands:
//   tag <version>          -> <tagPrefix><version>
//   asset <version> <id>   -> <tagPrefix><version>-<id>[.exe]
//   checksums <version>    -> <tagPrefix><version><checksumsSuffix>
//   tag-prefix             -> <tagPrefix>
//   targets                -> one line per target: "<bunTarget>\t<id>\t<0|1 exe>"
//   channels               -> one channel name per line
//   prerelease <channel>   -> "true" | "false"
//   github-env             -> key=value lines (all fields CI needs) for $GITHUB_ENV
//   validate               -> exit 1 if difyctl.release, version, or channel is malformed
//   compat-check <difyVer> -> exit 1 if difyVer outside compat.minDify..maxDify

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BUN_TARGET_RE = /^bun-(linux|darwin|windows)-(x64|arm64)$/
const SEMVER_CORE_LEN = 3

// Add channels here: { name, prerelease, versionForm }.
const CHANNELS = [
  { name: 'stable', prerelease: false, versionForm: /^\d+\.\d+\.\d+(\+[0-9A-Z.-]+)?$/i },
  { name: 'alpha', prerelease: true, versionForm: /^\d+\.\d+\.\d+-alpha(\.\d+)?$/ },
  { name: 'rc', prerelease: true, versionForm: /^\d+\.\d+\.\d+-rc\.\d+$/ },
  { name: 'edge', prerelease: true, versionForm: /^\d+\.\d+\.\d+-edge\.[0-9a-f]{7,40}$/ },
]

const channelByName = (name) => CHANNELS.find((c) => c.name === name)
const channelNames = () => CHANNELS.map((c) => c.name).join(', ')

function parsePrecedence(v) {
  const s = String(v).replace(/^v/, '').replace(/\+.*$/, '')
  const i = s.indexOf('-')
  const core = i === -1 ? s : s.slice(0, i)
  const pre = i === -1 ? '' : s.slice(i + 1)
  return { nums: core.split('.').map(Number), pre }
}

function versionCore(v) {
  return String(v).replace(/^v/, '').replace(/\+.*$/, '').split('-')[0]
}

function edgeVersion(sha) {
  if (!/^[0-9a-f]{7,40}$/.test(sha ?? ''))
    die('edge-version requires a git short sha (7-40 hex chars)')
  const { version } = loadPkg()
  const core = versionCore(version)
  if (!/^\d+\.\d+\.\d+$/.test(core)) die(`cannot derive edge base from version: ${version}`)
  return `${core}-edge.${sha}`
}

// Returns a problem string if `version` cannot be resolved under `channel`, else
// null. Shared by validateVersionForChannel (die-now) and validateVersionChannel
// (collect for the `validate` gate).
function channelVersionProblem(version, channel) {
  if (typeof version !== 'string' || version.length === 0)
    return 'version must be a non-empty string'
  const ch = channelByName(channel)
  if (!ch) return `unknown channel: ${channel} (expected one of: ${channelNames()})`
  if (!ch.versionForm.test(version))
    return `version ${version} does not match the ${channel} channel form`
  return null
}

function validateVersionForChannel(version, channelName) {
  const problem = channelVersionProblem(version, channelName)
  if (problem) die(problem)
  return `valid: ${version} is a ${channelName} version`
}

function comparePre(a, b) {
  const aparts = a.split('.')
  const bparts = b.split('.')
  const len = Math.max(aparts.length, bparts.length)
  for (let i = 0; i < len; i++) {
    if (aparts[i] === undefined) return -1
    if (bparts[i] === undefined) return 1
    const an = /^\d+$/.test(aparts[i])
    const bn = /^\d+$/.test(bparts[i])
    if (an && bn) {
      const d = Number(aparts[i]) - Number(bparts[i])
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (an !== bn) {
      return an ? -1 : 1
    } else if (aparts[i] !== bparts[i]) {
      return aparts[i] < bparts[i] ? -1 : 1
    }
  }
  return 0
}

function comparePrecedence(a, b) {
  const A = parsePrecedence(a)
  const B = parsePrecedence(b)
  for (let i = 0; i < SEMVER_CORE_LEN; i++) {
    const x = A.nums[i] ?? 0
    const y = B.nums[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  if (A.pre === B.pre) return 0
  if (A.pre === '') return 1
  if (B.pre === '') return -1
  return comparePre(A.pre, B.pre)
}

function die(msg) {
  process.stderr.write(`release-naming: ${msg}\n`)
  process.exit(1)
}

function loadPkg() {
  const pkgUrl = new URL('../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'))
  if (!pkg.difyctl?.release) die('cli/package.json missing difyctl.release')
  return {
    version: pkg.version,
    channel: pkg.difyctl.channel,
    compat: pkg.difyctl.compat ?? {},
    release: pkg.difyctl.release,
  }
}

// Emits key=value lines for $GITHUB_ENV.
function githubEnv() {
  const { version, channel, compat, release } = loadPkg()
  const fields = {
    version,
    channel,
    prerelease: channelByName(channel)?.prerelease ?? false,
    minDify: compat.minDify,
    maxDify: compat.maxDify,
    tagPrefix: release.tagPrefix,
    difyctlTag: `${release.tagPrefix}${version}`,
  }
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function requireVersion(version) {
  if (!version) die('version argument is required')
  return version
}

function assetName(release, version, id) {
  const target = release.targets.find((t) => t.id === id)
  if (!target) die(`unknown target id: ${id}`)
  const suffix = target.exe ? '.exe' : ''
  return `${release.tagPrefix}${version}-${id}${suffix}`
}

function validateRelease(release) {
  const problems = []
  const str = (v) => typeof v === 'string' && v.length > 0
  if (!str(release.tagPrefix)) problems.push('tagPrefix must be a non-empty string')
  if (!str(release.binName)) problems.push('binName must be a non-empty string')
  if (!str(release.checksumsSuffix)) problems.push('checksumsSuffix must be a non-empty string')
  if (!Array.isArray(release.targets) || release.targets.length === 0) {
    problems.push('targets must be a non-empty array')
    return problems
  }
  const seen = new Set()
  for (const t of release.targets) {
    const label = t?.id ?? JSON.stringify(t)
    if (!str(t?.id)) problems.push(`target ${label}: id must be a non-empty string`)
    else if (seen.has(t.id)) problems.push(`duplicate target id: ${t.id}`)
    else seen.add(t.id)
    if (!str(t?.bunTarget) || !BUN_TARGET_RE.test(t.bunTarget))
      problems.push(`target ${label}: bunTarget must match ${BUN_TARGET_RE}`)
    if (typeof t?.exe !== 'boolean') problems.push(`target ${label}: exe must be a boolean`)
    else if (str(t?.bunTarget) && t.exe !== t.bunTarget.startsWith('bun-windows-'))
      problems.push(`target ${label}: exe must be true iff bunTarget is bun-windows-*`)
  }
  return problems
}

function validateVersionChannel(version, channel) {
  const problem = channelVersionProblem(version, channel)
  return problem ? [problem] : []
}

function main(argv) {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'tag':
      return `${loadPkg().release.tagPrefix}${requireVersion(rest[0])}`
    case 'asset':
      return assetName(
        loadPkg().release,
        requireVersion(rest[0]),
        rest[1] ?? die('target id is required'),
      )
    case 'checksums': {
      const { release } = loadPkg()
      return `${release.tagPrefix}${requireVersion(rest[0])}${release.checksumsSuffix}`
    }
    case 'tag-prefix':
      return loadPkg().release.tagPrefix
    case 'targets':
      return loadPkg()
        .release.targets.map((t) => `${t.bunTarget}\t${t.id}\t${t.exe ? 1 : 0}`)
        .join('\n')
    case 'channels':
      return CHANNELS.map((c) => c.name).join('\n')
    case 'github-env':
      return githubEnv()
    case 'compat-check': {
      const { compat } = loadPkg()
      const difyVersion = requireVersion(rest[0])
      if (!compat.minDify || !compat.maxDify)
        die('cli/package.json missing difyctl.compat.minDify/maxDify')
      if (
        comparePrecedence(difyVersion, compat.minDify) < 0 ||
        comparePrecedence(difyVersion, compat.maxDify) > 0
      )
        die(
          `Dify ${difyVersion} is outside difyctl compatibility window ${compat.minDify}..${compat.maxDify}; bump difyctl.compat in cli/package.json`,
        )
      return `compatible: Dify ${difyVersion} within ${compat.minDify}..${compat.maxDify}`
    }
    case 'prerelease': {
      const ch = channelByName(rest[0] ?? die('channel argument is required'))
      if (!ch) die(`unknown channel: ${rest[0]} (expected one of: ${channelNames()})`)
      return String(ch.prerelease)
    }
    case 'validate': {
      const { version, channel, release } = loadPkg()
      const problems = [...validateRelease(release), ...validateVersionChannel(version, channel)]
      if (problems.length > 0)
        die(`invalid difyctl release config:\n  - ${problems.join('\n  - ')}`)
      return `difyctl release valid: version=${version} channel=${channel} targets=${release.targets.length}`
    }
    case 'edge-version':
      return edgeVersion(rest[0])
    case 'validate-version':
      return validateVersionForChannel(
        requireVersion(rest[0]),
        rest[1] ?? die('channel argument is required'),
      )
    default:
      die(`unknown subcommand: ${cmd ?? '(none)'}`)
  }
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.stdout.write(`${main(process.argv.slice(2))}\n`)

export {
  assetName,
  channelByName,
  CHANNELS,
  edgeVersion,
  loadPkg,
  validateVersionForChannel,
  versionCore,
}
