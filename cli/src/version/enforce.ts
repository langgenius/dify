import type { ServerVersionResponse } from '@dify/contracts/api/openapi/types.gen'
import type { CompatStore } from '@/cache/compat-store'
import { META_PROBE_TIMEOUT_MS, MetaClient } from '@/api/meta'
import { loadCompatStore } from '@/cache/compat-store'
import { newError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { createHttpClient } from '@/http/client'
import { openAPIBase } from '@/util/host'
import { difyCompat, evaluateCompat } from './compat'
import { versionInfo } from './info'

export type ServerVersionProbe = (host: string) => Promise<ServerVersionResponse>

const UPGRADE_HINT =
  `upgrade the Dify server to >= ${difyCompat.minDify} ` +
  '(https://docs.dify.ai/en/getting-started/install-self-hosted)'

// /_version is unauthenticated; same timeout/no-retry budget as the auto-nudge probe.
function buildDefaultProbe(insecure: boolean): ServerVersionProbe {
  return async (host) => {
    const http = createHttpClient({
      baseURL: openAPIBase(host),
      timeoutMs: META_PROBE_TIMEOUT_MS,
      retryAttempts: 0,
      insecure,
    })
    return new MetaClient(http).serverVersion()
  }
}

export type EnforceOptions = {
  readonly probe?: ServerVersionProbe
  readonly store?: CompatStore
  readonly forceFresh?: boolean
  readonly insecure?: boolean
}

/**
 * Hard version gate for the client → server direction: refuse a Dify server older
 * than this difyctl requires (its removed paths would only 404 otherwise).
 *
 * Cached: a host recently confirmed compatible is not re-probed for COMPAT_TTL_MS.
 * Only "compatible" is cached, so a just-upgraded server clears a previous block at
 * once. Fails open on any probe error — a flaky network never blocks a command.
 * Returns the probed server version when it actually probed (skipped/failed → undefined),
 * so the caller can reuse it.
 */
export async function enforceDifyVersion(
  host: string,
  opts: EnforceOptions = {},
): Promise<ServerVersionResponse | undefined> {
  const store = opts.store ?? (await loadCompatStore())
  if (opts.forceFresh !== true && store.isFreshCompatible(host)) return undefined

  const probe = opts.probe ?? buildDefaultProbe(opts.insecure === true)
  let server: ServerVersionResponse
  try {
    server = await probe(host)
  } catch {
    return undefined
  }

  const verdict = evaluateCompat(server.version)
  if (verdict.status === 'too_old') {
    throw newError(
      ErrorCode.VersionSkew,
      `Dify server ${server.version} is too old for difyctl ${versionInfo.version}: ${verdict.detail}`,
    ).withHint(UPGRADE_HINT)
  }

  if (verdict.status === 'compatible' || verdict.status === 'too_new')
    await store.markCompatible(host)

  return server
}
