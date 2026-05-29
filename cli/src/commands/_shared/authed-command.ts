import type { KyInstance } from 'ky'
import type { ActiveContext } from '../../auth/hosts.js'
import type { AppInfoCache } from '../../cache/app-info.js'
import type { Command } from '../../framework/command.js'
import type { Store } from '../../store/store.js'
import type { IOStreams } from '../../sys/io/streams'
import { META_PROBE_TIMEOUT_MS, MetaClient } from '../../api/meta.js'
import { notLoggedInError, Registry } from '../../auth/hosts.js'
import { loadAppInfoCache } from '../../cache/app-info.js'
import { loadNudgeStore } from '../../cache/nudge-store.js'
import { getEnv } from '../../env/registry.js'
import { formatErrorForCli } from '../../errors/format.js'
import { createClient } from '../../http/client.js'
import { getTokenStore, tokenKey } from '../../store/manager.js'
import { realStreams } from '../../sys/io/streams'
import { hostWithScheme } from '../../util/host.js'
import { versionInfo } from '../../version/info.js'
import { maybeNudgeCompat } from '../../version/nudge.js'
import { resolveRetryAttempts } from './global-flags.js'

export type AuthedContext = {
  readonly reg: Registry
  readonly active: ActiveContext
  readonly store: Store
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
  const reg = Registry.load()
  const active = reg.resolveActive()
  if (active === undefined)
    fail(cmd, opts, io)

  const { store } = getTokenStore()
  const bearer = store.get(tokenKey(active.host, active.email))
  if (bearer === '')
    fail(cmd, opts, io)

  const host = hostWithScheme(active.host, active.scheme)
  const retryAttempts = resolveRetryAttempts({ flag: opts.retryFlag, env: getEnv })
  const http = createClient({ host, bearer, retryAttempts })

  const cache = opts.withCache === true ? await loadAppInfoCache() : undefined

  await runCompatNudge({ host, io })

  return { reg, active, store, http, host, io, cache }
}

function fail(cmd: Pick<Command, 'error'>, opts: AuthedContextOptions, io: IOStreams): never {
  const err = notLoggedInError()
  cmd.error(formatErrorForCli(err, { format: opts.format, isErrTTY: io.isErrTTY }), { exit: err.exit() })
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
