import type { KyInstance } from 'ky'
import type { HostsBundle } from '@/auth/hosts'
import type { Store } from '@/store/store'
import type { IOStreams } from '@/sys/io/streams'
import { AccountSessionsClient } from '@/api/account-sessions'
import { clearLocal } from '@/auth/hosts'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { getTokenStore } from '@/store/manager'
import { colorEnabled, colorScheme } from '@/sys/io/color'

export type LogoutOptions = {
  readonly io: IOStreams
  readonly bundle: HostsBundle | undefined
  readonly http?: KyInstance
  /** Optional override for tests; production code resolves via `getTokenStore`. */
  readonly store?: Store
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

  const tokens = opts.store ?? getTokenStore().store
  clearLocal(bundle, tokens)

  if (revokeWarning !== '')
    opts.io.err.write(revokeWarning)
  opts.io.out.write(`${cs.successIcon()} Logged out of ${bundle.current_host}\n`)
}

const REVOCABLE_PREFIXES = ['dfoa_', 'dfoe_'] as const

function revokeAllowed(bearer: string): boolean {
  return REVOCABLE_PREFIXES.some(p => bearer.startsWith(p))
}
