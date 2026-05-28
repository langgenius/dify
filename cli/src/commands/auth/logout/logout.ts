import type { KyInstance } from 'ky'
import type { HostsBundle } from '../../../auth/hosts.js'
import type { TokenStore } from '../../../auth/store.js'
import type { IOStreams } from '../../../io/streams.js'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { AccountSessionsClient } from '../../../api/account-sessions.js'
import { HOSTS_FILE_NAME } from '../../../auth/hosts.js'
import { BaseError } from '../../../errors/base.js'
import { ErrorCode } from '../../../errors/codes.js'
import { colorEnabled, colorScheme } from '../../../io/color.js'

export type LogoutOptions = {
  readonly configDir: string
  readonly io: IOStreams
  readonly bundle: HostsBundle | undefined
  readonly http?: KyInstance
  readonly store: TokenStore
}

export async function runLogout(opts: LogoutOptions): Promise<void> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const bundle = opts.bundle
  if (bundle === undefined || bundle.current_host === '' || bundle.tokens?.bearer === undefined || bundle.tokens.bearer === '') {
    throw new BaseError({
      code: ErrorCode.NotLoggedIn,
      message: 'not logged in',
      hint: 'run \'difyctl auth login\'',
    })
  }

  let revokeWarning = ''
  if (revokeAllowed(bundle.tokens.bearer) && opts.http !== undefined) {
    try {
      const sessions = new AccountSessionsClient(opts.http)
      await sessions.revokeSelf()
    }
    catch (err) {
      revokeWarning = `${cs.warningIcon()} server revoke failed (${(err as Error).message}); local credentials cleared anyway\n`
    }
  }

  await clearLocal(opts.configDir, bundle, opts.store)

  if (revokeWarning !== '')
    opts.io.err.write(revokeWarning)
  opts.io.out.write(`${cs.successIcon()} Logged out of ${bundle.current_host}\n`)
}

const REVOCABLE_PREFIXES = ['dfoa_', 'dfoe_'] as const

function revokeAllowed(bearer: string): boolean {
  return REVOCABLE_PREFIXES.some(p => bearer.startsWith(p))
}

async function clearLocal(configDir: string, bundle: HostsBundle, store: TokenStore): Promise<void> {
  const accountId = bundle.account?.id ?? bundle.external_subject?.email ?? 'default'
  try {
    await store.delete(bundle.current_host, accountId)
  }
  catch { /* best-effort */ }
  const hostsPath = join(configDir, HOSTS_FILE_NAME)
  try {
    await unlink(hostsPath)
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      throw err
  }
}
