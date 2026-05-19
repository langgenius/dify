import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../auth/hosts.js'
import type { AppInfoCache } from '../../cache/app-info.js'
import type { Command } from '../../framework/command.js'
import type { IOStreams } from '../../io/streams.js'
import { loadHosts } from '../../auth/hosts.js'
import { loadAppInfoCache } from '../../cache/app-info.js'
import { resolveConfigDir } from '../../config/dir.js'
import { BaseError } from '../../errors/base.js'
import { ErrorCode } from '../../errors/codes.js'
import { formatErrorForCli } from '../../errors/format.js'
import { createClient } from '../../http/client.js'
import { realStreams } from '../../io/streams.js'
import { hostWithScheme } from '../../util/host.js'
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

  return { bundle, http, host, io, configDir, cache }
}
