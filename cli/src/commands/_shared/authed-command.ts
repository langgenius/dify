import type { ActiveContext } from '@/auth/hosts'
import type { AppInfoCache } from '@/cache/app-info'
import type { Command } from '@/framework/command'
import type { HttpClient } from '@/http/types'
import type { TokenStore } from '@/store/token-store'
import type { IOStreams } from '@/sys/io/streams'
import { META_PROBE_TIMEOUT_MS, MetaClient } from '@/api/meta'
import { notLoggedInError, Registry } from '@/auth/hosts'
import { loadAppInfoCache } from '@/cache/app-info'
import { loadNudgeStore } from '@/cache/nudge-store'
import { getEnv } from '@/env/registry'
import { formatErrorForCli } from '@/errors/format'
import { createHttpClient } from '@/http/client'
import { getTokenStore } from '@/store/manager'
import { realStreams } from '@/sys/io/streams'
import { activeHostInfo, openAPIBase } from '@/util/host'
import { enforceDifyVersion } from '@/version/enforce'
import { versionInfo } from '@/version/info'
import { maybeNudgeCompat } from '@/version/nudge'
import { resolveRetryAttempts } from './global-flags.js'

export type AuthedContext = {
  readonly reg: Registry
  readonly active: ActiveContext
  readonly store: TokenStore
  readonly http: HttpClient
  readonly host: string
  readonly io: IOStreams
  readonly cache?: AppInfoCache
}

export type AuthedContextOptions = {
  readonly retryFlag: number | undefined
  readonly withCache?: boolean
  readonly format?: string
}

export async function buildAuthedContext(
  cmd: Pick<Command, 'error'>,
  opts: AuthedContextOptions,
): Promise<AuthedContext> {
  const io = realStreams(opts.format ?? '')
  const reg = await Registry.load()
  const active = reg.resolveActive()
  if (active === undefined) fail(cmd, opts, io)

  const store = getTokenStore(reg.token_storage)
  const bearer = await store.read(active.host, active.email)
  if (bearer === '') fail(cmd, opts, io)

  const { host, insecure } = activeHostInfo(active)
  const retryAttempts = resolveRetryAttempts({ flag: opts.retryFlag, env: getEnv })
  const http = createHttpClient({ baseURL: openAPIBase(host), bearer, retryAttempts, insecure })

  const cache = opts.withCache === true ? await loadAppInfoCache() : undefined

  // Hard gate: refuse a server too old for this difyctl (throws → exit 6).
  // Cached per host (1h) so most commands don't re-probe. Then the soft nudge
  // handles the "server too new" direction.
  await enforceDifyVersion(host, { insecure })
  await runCompatNudge({ host, insecure, io })

  return { reg, active, store, http, host, io, cache }
}

function fail(cmd: Pick<Command, 'error'>, opts: AuthedContextOptions, io: IOStreams): never {
  const err = notLoggedInError()
  cmd.error(formatErrorForCli(err, { format: opts.format, isErrTTY: io.isErrTTY }), {
    exit: err.exit(),
  })
}

// Best-effort nudge: never throws, never blocks. Lives here so every authed
// command flows through it without per-command wiring.
async function runCompatNudge(opts: {
  readonly host: string
  readonly insecure: boolean
  readonly io: IOStreams
}): Promise<void> {
  try {
    const store = await loadNudgeStore()
    await maybeNudgeCompat(opts.host, {
      store,
      probe: async (host) => {
        const http = createHttpClient({
          baseURL: openAPIBase(host),
          timeoutMs: META_PROBE_TIMEOUT_MS,
          retryAttempts: 0,
          insecure: opts.insecure,
        })
        return new MetaClient(http).serverVersion()
      },
      emit: (line) => opts.io.err.write(line),
      isTty: opts.io.isOutTTY,
      format: opts.io.outputFormat,
      clientVersion: versionInfo.version,
      color: opts.io.isErrTTY,
    })
  } catch {
    // already swallowed inside maybeNudgeCompat; this is belt-and-braces
  }
}
