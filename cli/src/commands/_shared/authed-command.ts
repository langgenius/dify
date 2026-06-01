import type { KyInstance } from 'ky'
import type { HostsBundle } from '@/auth/hosts'
import type { AppInfoCache } from '@/cache/app-info'
import type { Command } from '@/framework/command'
import type { IOStreams } from '@/sys/io/streams'
import { META_PROBE_TIMEOUT_MS, MetaClient } from '@/api/meta'
import { loadHosts } from '@/auth/hosts'
import { loadAppInfoCache } from '@/cache/app-info'
import { loadNudgeStore } from '@/cache/nudge-store'
import { getEnv } from '@/env/registry'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { formatErrorForCli } from '@/errors/format'
import { createClient } from '@/http/client'
import { realStreams } from '@/sys/io/streams'
import { hostWithScheme } from '@/util/host'
import { versionInfo } from '@/version/info'
import { maybeNudgeCompat } from '@/version/nudge'
import { resolveRetryAttempts } from './global-flags'

export type AuthedContext = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
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
  const bundle = loadHosts()
  if (bundle === undefined || bundle.tokens?.bearer === undefined || bundle.tokens.bearer === '') {
    const err = new BaseError({
      code: ErrorCode.NotLoggedIn,
      message: 'not logged in',
      hint: 'run \'difyctl auth login\'',
    })
    cmd.error(formatErrorForCli(err, { format: opts.format, isErrTTY: io.isErrTTY }), { exit: err.exit() })
  }

  const host = hostWithScheme(bundle.current_host, bundle.scheme)
  const retryAttempts = resolveRetryAttempts({
    flag: opts.retryFlag,
    env: getEnv,
  })
  const http = createClient({ host, bearer: bundle.tokens.bearer, retryAttempts })

  const cache = opts.withCache === true ? await loadAppInfoCache() : undefined

  await runCompatNudge({ host, io })

  return { bundle, http, host, io, cache }
}

// Best-effort nudge: never throws, never blocks. Lives here so every authed
// command flows through it without per-command wiring.
async function runCompatNudge(opts: {
  readonly host: string
  readonly io: IOStreams
}): Promise<void> {
  try {
    const store = await loadNudgeStore()
    await maybeNudgeCompat(opts.host, {
      store,
      probe: async (host) => {
        const http = createClient({ host, timeoutMs: META_PROBE_TIMEOUT_MS, retryAttempts: 0 })
        return new MetaClient(http).serverVersion()
      },
      emit: line => opts.io.err.write(line),
      isTty: opts.io.isOutTTY,
      format: opts.io.outputFormat,
      clientVersion: versionInfo.version,
      color: opts.io.isErrTTY,
    })
  }
  catch {
    // already swallowed inside maybeNudgeCompat; this is belt-and-braces
  }
}
