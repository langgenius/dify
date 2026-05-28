import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../auth/hosts.js'
import type { AppInfoCache } from '../../cache/app-info.js'
import type { Command } from '../../framework/command.js'
import type { IOStreams } from '../../io/streams.js'
import { META_PROBE_TIMEOUT_MS, MetaClient } from '../../api/meta.js'
import { loadHosts } from '../../auth/hosts.js'
import { loadAppInfoCache } from '../../cache/app-info.js'
import { loadNudgeStore } from '../../cache/nudge-store.js'
import { resolveConfigDir } from '../../config/dir.js'
import { BaseError } from '../../errors/base.js'
import { ErrorCode } from '../../errors/codes.js'
import { formatErrorForCli } from '../../errors/format.js'
import { createClient } from '../../http/client.js'
import { realStreams } from '../../io/streams.js'
import { hostWithScheme } from '../../util/host.js'
import { versionInfo } from '../../version/info.js'
import { maybeNudgeCompat } from '../../version/nudge.js'
import { resolveRetryAttempts } from './global-flags.js'

export type AuthedContext = {
  readonly bundle: HostsBundle
  readonly http: KyInstance
  readonly host: string
  readonly io: IOStreams
  readonly configDir: string
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
  const configDir = resolveConfigDir()
  const bundle = await loadHosts(configDir)
  if (bundle === undefined || bundle.tokens?.bearer === undefined || bundle.tokens.bearer === '') {
    const err = new BaseError({
      code: ErrorCode.NotLoggedIn,
      message: 'not logged in',
      hint: 'run \'difyctl auth login\'',
    })
    cmd.error(formatErrorForCli(err, { format: opts.format, isErrTTY: process.stderr.isTTY }), { exit: err.exit() })
  }

  const host = hostWithScheme(bundle.current_host, bundle.scheme)
  const retryAttempts = resolveRetryAttempts({
    flag: opts.retryFlag,
    env: (k: string) => process.env[k],
  })
  const http = createClient({ host, bearer: bundle.tokens.bearer, retryAttempts })
  const io = realStreams(opts.format ?? '')

  const cache = opts.withCache === true ? await loadAppInfoCache({ configDir }) : undefined

  await runCompatNudge({ configDir, host, io })

  return { bundle, http, host, io, configDir, cache }
}

// Best-effort nudge: never throws, never blocks. Lives here so every authed
// command flows through it without per-command wiring.
async function runCompatNudge(opts: {
  readonly configDir: string
  readonly host: string
  readonly io: IOStreams
}): Promise<void> {
  try {
    const store = await loadNudgeStore({ configDir: opts.configDir })
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
