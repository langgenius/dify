#!/usr/bin/env node
// release-naming.mjs — single source of truth for difyctl release artifact
// names. Reads naming DATA from cli/package.json `difyctl.release` and owns the
// name FORMAT. Producer scripts (release-build.sh, release-write-checksums.sh,
// cli-release.yml) call this instead of hardcoding names.
//
// Subcommands:
//   tag <version>          -> <tagPrefix><version>
//   asset <version> <id>   -> <tagPrefix><version>-<id>[.exe]
//   checksums <version>    -> <tagPrefix><version><checksumsSuffix>
//   tag-prefix             -> <tagPrefix>
//   targets                -> one line per target: "<bunTarget>\t<id>\t<0|1 exe>"
//   validate               -> exit 1 with message if difyctl.release is malformed

import { readFileSync } from 'node:fs'

const BUN_TARGET_RE = /^bun-(linux|darwin|windows)-(x64|arm64)$/

function die(msg) {
  process.stderr.write(`release-naming: ${msg}\n`)
  process.exit(1)
}

function loadRelease() {
  const pkgUrl = new URL('../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'))
  const release = pkg.difyctl?.release
  if (!release)
    die('cli/package.json missing difyctl.release')
  return release
}

function requireVersion(version) {
  if (!version)
    die('version argument is required')
  return version
}

function assetName(release, version, id) {
  const target = release.targets.find(t => t.id === id)
  if (!target)
    die(`unknown target id: ${id}`)
  const suffix = target.exe ? '.exe' : ''
  return `${release.tagPrefix}${version}-${id}${suffix}`
}

function validate(release) {
  const problems = []
  const str = v => typeof v === 'string' && v.length > 0
  if (!str(release.tagPrefix))
    problems.push('tagPrefix must be a non-empty string')
  if (!str(release.binName))
    problems.push('binName must be a non-empty string')
  if (!str(release.checksumsSuffix))
    problems.push('checksumsSuffix must be a non-empty string')
  if (!Array.isArray(release.targets) || release.targets.length === 0) {
    problems.push('targets must be a non-empty array')
    return problems
  }
  const seen = new Set()
  for (const t of release.targets) {
    const label = t?.id ?? JSON.stringify(t)
    if (!str(t?.id))
      problems.push(`target ${label}: id must be a non-empty string`)
    else if (seen.has(t.id))
      problems.push(`duplicate target id: ${t.id}`)
    else seen.add(t.id)
    if (!str(t?.bunTarget) || !BUN_TARGET_RE.test(t.bunTarget))
      problems.push(`target ${label}: bunTarget must match ${BUN_TARGET_RE}`)
    if (typeof t?.exe !== 'boolean')
      problems.push(`target ${label}: exe must be a boolean`)
    else if (str(t?.bunTarget) && t.exe !== t.bunTarget.startsWith('bun-windows-'))
      problems.push(`target ${label}: exe must be true iff bunTarget is bun-windows-*`)
  }
  return problems
}

function main(argv) {
  const [cmd, ...rest] = argv
  const release = loadRelease()
  switch (cmd) {
    case 'tag':
      return `${release.tagPrefix}${requireVersion(rest[0])}`
    case 'asset':
      return assetName(release, requireVersion(rest[0]), rest[1] ?? die('target id is required'))
    case 'checksums':
      return `${release.tagPrefix}${requireVersion(rest[0])}${release.checksumsSuffix}`
    case 'tag-prefix':
      return release.tagPrefix
    case 'targets':
      return release.targets.map(t => `${t.bunTarget}\t${t.id}\t${t.exe ? 1 : 0}`).join('\n')
    case 'validate': {
      const problems = validate(release)
      if (problems.length > 0)
        die(`invalid difyctl.release:\n  - ${problems.join('\n  - ')}`)
      return `difyctl.release valid: ${release.targets.length} targets, tagPrefix=${release.tagPrefix}`
    }
    default:
      die(`unknown subcommand: ${cmd ?? '(none)'}`)
  }
}

process.stdout.write(`${main(process.argv.slice(2))}\n`)
