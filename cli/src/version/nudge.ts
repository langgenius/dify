import type { CompatSnapshot, CompatSnapshotStore } from '../cache/compat-snapshot.js'
import type { ServerVersionResponse } from '../types/data-contracts.js'
import pc from 'picocolors'
import { difyCompat, evaluateCompat } from './compat.js'
import { versionInfo } from './info.js'

const SUPPRESSED_FORMATS: ReadonlySet<string> = new Set(['json', 'yaml', 'name'])

export type NudgeDeps = {
  readonly store: CompatSnapshotStore
  // /openapi/v1/_version is intentionally unauthenticated (mirrors _health), so
  // the probe does not need a bearer.
  readonly probe: (host: string) => Promise<ServerVersionResponse>
  readonly emit: (line: string) => void
  readonly isTty: boolean
  readonly format: string
  readonly color?: boolean
  readonly now?: () => Date
}

// Public guarantee: never throws. Every internal failure is silenced so that
// the calling authed command continues regardless of probe / disk / parse
// errors.
export async function maybeNudgeCompat(
  host: string,
  deps: NudgeDeps,
): Promise<void> {
  try {
    const snapshot = await ensureSnapshot(host, deps)
    if (snapshot === undefined)
      return
    if (!shouldBanner(snapshot, deps))
      return
    deps.emit(formatBanner(snapshot, deps.color === true))
    await deps.store.markWarned(host, deps.now?.())
  }
  catch {
    // swallow: the nudge must never affect the business command
  }
}

async function ensureSnapshot(
  host: string,
  deps: NudgeDeps,
): Promise<CompatSnapshot | undefined> {
  const existing = deps.store.get(host)
  if (existing !== undefined && deps.store.isFresh(existing, deps.now?.()))
    return existing

  // stale or missing → try a refresh
  let server: ServerVersionResponse
  try {
    server = await deps.probe(host)
  }
  catch {
    return existing // may be undefined; that signals "first-time-quiet"
  }

  const verdict = evaluateCompat(server.version)
  const fresh: CompatSnapshot = {
    host,
    fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
    lastWarnedAt: existing?.lastWarnedAt,
    server,
    compat: {
      status: verdict.status,
      detail: verdict.detail,
      minDify: difyCompat.minDify,
      maxDify: difyCompat.maxDify,
    },
  }
  try {
    await deps.store.set(fresh)
  }
  catch {
    // disk failure shouldn't block warn decision
  }

  // First-time quiet: cold cache only persists; never warns on the very
  // first command after install.
  if (existing === undefined)
    return undefined

  return fresh
}

function shouldBanner(snapshot: CompatSnapshot, deps: NudgeDeps): boolean {
  if (snapshot.compat.status !== 'unsupported')
    return false
  if (!deps.isTty)
    return false
  if (SUPPRESSED_FORMATS.has(deps.format))
    return false
  if (!deps.store.canWarn(snapshot, deps.now?.()))
    return false
  return true
}

function formatBanner(snapshot: CompatSnapshot, color: boolean): string {
  const paint = color ? pc.yellow : (s: string) => s
  const { minDify, maxDify } = snapshot.compat
  const line
    = `warning: difyctl ${versionInfo.version} may be incompatible with server `
      + `${snapshot.server.version} (tested: ${minDify}..${maxDify}). `
      + 'Run `difyctl version` for details.'
  return `${paint(line)}\n`
}
