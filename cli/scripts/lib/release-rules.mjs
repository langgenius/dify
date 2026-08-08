// Pure release naming and version rules. Nothing here reads a file, prints, or
// exits — the CLI shells own all of that.

const BUN_TARGET_RE = /^bun-(linux|darwin|windows)-(x64|arm64)$/
const SEMVER_CORE_LEN = 3

// Add channels here: { name, prerelease, versionForm }.
export const CHANNELS = [
  { name: 'stable', prerelease: false, versionForm: /^\d+\.\d+\.\d+(\+[0-9A-Z.-]+)?$/i },
  { name: 'alpha', prerelease: true, versionForm: /^\d+\.\d+\.\d+-alpha(\.\d+)?$/ },
  { name: 'rc', prerelease: true, versionForm: /^\d+\.\d+\.\d+-rc\.\d+$/ },
  { name: 'edge', prerelease: true, versionForm: /^\d+\.\d+\.\d+-edge\.[0-9a-f]{7,40}$/ },
]

export const EDGE_SHA_RE = /^[0-9a-f]{7,40}$/

export const channelByName = (name) => CHANNELS.find((c) => c.name === name)
export const channelNames = () => CHANNELS.map((c) => c.name).join(', ')

export function versionCore(v) {
  return String(v).replace(/^v/, '').replace(/\+.*$/, '').split('-')[0]
}

// Compat ordering compares the numeric A.B.C core only: prerelease and build
// suffixes are stripped first, so 1.16.0-rc.1 ranks equal to 1.16.0. This
// matches the runtime check in src/version/compat.ts.
function compareCore(a, b) {
  const A = versionCore(a).split('.').map(Number)
  const B = versionCore(b).split('.').map(Number)
  for (let i = 0; i < SEMVER_CORE_LEN; i++) {
    const x = A[i] ?? 0
    const y = B[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

export function isWithinCompatWindow(version, { minDify, maxDify }) {
  return compareCore(version, minDify) >= 0 && compareCore(version, maxDify) <= 0
}

// Returns a problem string if `version` cannot be resolved under `channel`,
// else null.
export function channelVersionProblem(version, channel) {
  if (typeof version !== 'string' || version.length === 0)
    return 'version must be a non-empty string'
  const ch = channelByName(channel)
  if (!ch) return `unknown channel: ${channel} (expected one of: ${channelNames()})`
  if (!ch.versionForm.test(version))
    return `version ${version} does not match the ${channel} channel form`
  return null
}

// Returns a problem string if the edge base cannot be derived, else null.
export function edgeVersionProblem(version, sha) {
  if (!EDGE_SHA_RE.test(sha ?? '')) return 'edge-version requires a git short sha (7-40 hex chars)'
  if (!/^\d+\.\d+\.\d+$/.test(versionCore(version)))
    return `cannot derive edge base from version: ${version}`
  return null
}

export function edgeVersionFrom(version, sha) {
  return `${versionCore(version)}-edge.${sha}`
}

export function tagName(release, version) {
  return `${release.tagPrefix}${version}`
}

export function checksumsName(release, version) {
  return `${release.tagPrefix}${version}${release.checksumsSuffix}`
}

export function assetNameFor(release, version, id) {
  const target = release.targets.find((t) => t.id === id)
  if (!target) return null
  return `${release.tagPrefix}${version}-${id}${target.exe ? '.exe' : ''}`
}

export function compatProblems(compat) {
  const str = (v) => typeof v === 'string' && v.length > 0
  const problems = []
  if (!str(compat?.minDify)) problems.push('compat.minDify must be a non-empty string')
  if (!str(compat?.maxDify)) problems.push('compat.maxDify must be a non-empty string')
  if (problems.length === 0 && compareCore(compat.minDify, compat.maxDify) > 0)
    problems.push(
      `compat.minDify ${compat.minDify} must not exceed compat.maxDify ${compat.maxDify}`,
    )
  return problems
}

export function releaseConfigProblems(release) {
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
