import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { NudgeStore } from '@/cache/nudge-store'
import { colorScheme } from '@/sys/io/color'
import { difyCompat, evaluateCompat } from './compat'

// Formats whose stdout is structured data (json/yaml) or a single name token —
// any stderr banner from us would pollute machine parsing. Default text format
// (the empty string) intentionally falls through and is allowed to warn.
const SUPPRESSED_FORMATS: ReadonlySet<string> = new Set(['json', 'yaml', 'name'])

export type NudgeDeps = {
  readonly store: NudgeStore
  // /openapi/v1/_version is intentionally unauthenticated (mirrors _health),
  // so the probe does not need a bearer.
  readonly probe: (host: string) => Promise<ServerVersionResponse>
  readonly emit: (line: string) => void
  readonly isTty: boolean
  readonly format: string
  readonly clientVersion: string
  readonly color?: boolean
  readonly now?: () => Date
}

// Public guarantee: never throws. Every internal failure is silenced so the
// calling authed command continues regardless of probe / disk errors.
//
// Order matters: cheap suppression checks (format, TTY, throttle window) run
// before any I/O so the happy path costs nothing in steady state.
export async function maybeNudgeCompat(host: string, deps: NudgeDeps): Promise<void> {
  try {
    if (!deps.isTty)
      return
    if (SUPPRESSED_FORMATS.has(deps.format))
      return
    if (!deps.store.canWarn(host, deps.now?.()))
      return

    let server: ServerVersionResponse
    try {
      server = await deps.probe(host)
    }
    catch {
      return
    }

    const verdict = evaluateCompat(server.version)
    if (verdict.status !== 'unsupported')
      return

    deps.emit(formatBanner(deps.clientVersion, server.version, deps.color === true))
    await deps.store.markWarned(host, deps.now?.()).catch(() => {
      // disk failure must not propagate; the user already saw the banner.
    })
  }
  catch {
    // belt-and-braces: any unexpected throw must not affect the business command
  }
}

function formatBanner(clientVersion: string, serverVersion: string, color: boolean): string {
  const { yellow } = colorScheme(color)
  const { minDify, maxDify } = difyCompat
  const line
    = `warning: difyctl ${clientVersion} may be incompatible with server `
      + `${serverVersion} (tested: ${minDify}..${maxDify}). `
      + 'Run `difyctl version` for details.'
  return `${yellow(line)}\n`
}
