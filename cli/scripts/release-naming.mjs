// release-naming.mjs — single source of truth for difyctl release artifact
// names and version/channel rules. Reads DATA from cli/package.json
// `difyctl.release` (plus `version` and `difyctl.channel`); the name FORMAT and
// the per-channel version form live in lib/release-rules.mjs. Producer scripts
// call this; `validate` is the release gate.
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
import {
  assetNameFor,
  channelByName,
  channelNames,
  CHANNELS,
  channelVersionProblem,
  checksumsName,
  compatProblems,
  edgeVersionFrom,
  edgeVersionProblem,
  isWithinCompatWindow,
  releaseConfigProblems,
  tagName,
} from './lib/release-rules.mjs'

const PKG_URL = new URL('../package.json', import.meta.url)

class UsageError extends Error {}

// Arrow so TS infers `never`, keeping expression positions like `x ?? die(...)` typed.
const die = (msg) => {
  throw new UsageError(msg)
}

function loadPkg(pkgPath = PKG_URL) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
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
    difyctlTag: tagName(release, version),
  }
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

function requireVersion(version) {
  if (!version) die('version argument is required')
  return version
}

function main(argv) {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'tag':
      return tagName(loadPkg().release, requireVersion(rest[0]))
    case 'asset': {
      const { release } = loadPkg()
      const version = requireVersion(rest[0])
      const id = rest[1] ?? die('target id is required')
      return assetNameFor(release, version, id) ?? die(`unknown target id: ${id}`)
    }
    case 'checksums':
      return checksumsName(loadPkg().release, requireVersion(rest[0]))
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
      if (!isWithinCompatWindow(difyVersion, compat))
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
      const { version, channel, compat, release } = loadPkg()
      const versionProblem = channelVersionProblem(version, channel)
      const problems = [
        ...releaseConfigProblems(release),
        ...compatProblems(compat),
        ...(versionProblem ? [versionProblem] : []),
      ]
      if (problems.length > 0)
        die(`invalid difyctl release config:\n  - ${problems.join('\n  - ')}`)
      return `difyctl release valid: version=${version} channel=${channel} targets=${release.targets.length}`
    }
    case 'edge-version': {
      const { version } = loadPkg()
      const sha = rest[0]
      const problem = edgeVersionProblem(version, sha)
      if (problem) die(problem)
      return edgeVersionFrom(version, sha)
    }
    case 'validate-version': {
      const version = requireVersion(rest[0])
      const channel = rest[1] ?? die('channel argument is required')
      const problem = channelVersionProblem(version, channel)
      if (problem) die(problem)
      return `valid: ${version} is a ${channel} version`
    }
    default:
      die(`unknown subcommand: ${cmd ?? '(none)'}`)
  }
}

const invokedDirectly =
  process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  try {
    process.stdout.write(`${main(process.argv.slice(2))}\n`)
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    process.stderr.write(`release-naming: ${e.message}\n`)
    process.exit(1)
  }
}

export { loadPkg, main }
