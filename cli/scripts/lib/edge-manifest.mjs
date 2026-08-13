import { assetNameFor } from './release-rules.mjs'

// checksums lines are "<sha256>  <assetName>"
export function parseChecksums(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+(\S+)$/i)
    if (m) map.set(m[2], m[1])
  }
  return map
}

// Newline-delimited dir names of binaries that still exist in R2.
export function parseDirList(text) {
  const set = new Set()
  for (const line of text.split('\n')) {
    const d = line.trim()
    if (d) set.add(d)
  }
  return set
}

export function resolveTargets(release, version, shas) {
  const targets = []
  const missing = []
  for (const t of release.targets) {
    const asset = assetNameFor(release, version, t.id)
    const sha = shas.get(asset)
    if (sha) targets.push({ id: t.id, asset, sha })
    else missing.push(asset)
  }
  return { targets, missing }
}

export function renderManifest({
  binName,
  channel,
  version,
  commit,
  buildDate,
  compat,
  baseUrl,
  targets,
}) {
  const head = {
    schema: 1,
    name: binName,
    channel,
    version,
    commit,
    buildDate,
    compat: { minDify: compat.minDify, maxDify: compat.maxDify },
    baseUrl,
  }
  const headLines = Object.entries(head)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n')
  const targetLines = targets
    .map(
      (t) =>
        `    ${JSON.stringify(t.id)}: { "asset": ${JSON.stringify(t.asset)}, "sha256": ${JSON.stringify(t.sha)} }`,
    )
    .join(',\n')
  return `{\n${headLines},\n  "targets": {\n${targetLines}\n  }\n}\n`
}

// `current` is the parsed ledger or null (first publish). `existingDirs` is a
// Set of build dirs still present in R2, or null when the caller could not list
// them — lifecycle/TTL on the bin prefix is the only deletion mechanism, so the
// ledger must never advertise a build whose binary is gone. The new build is
// always kept (just uploaded). No count cap.
export function buildIndex({ channel, version, commit, buildDate, current, existingDirs }) {
  const entry = { version, commit, buildDate, dir: version }
  const kept = (current?.builds ?? []).filter((b) => b.version !== entry.version)
  let builds = [entry, ...kept]
  if (existingDirs) builds = builds.filter((b) => b.dir === entry.dir || existingDirs.has(b.dir))
  return { schema: 1, channel, updated: buildDate, builds }
}
