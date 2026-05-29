import type { KyInstance } from 'ky'
import type { Registry } from '../../../auth/hosts.js'
import type { Store } from '../../../store/store.js'
import type { IOStreams } from '../../../sys/io/streams'
import { AccountSessionsClient } from '../../../api/account-sessions.js'
import { getTokenStore, tokenKey } from '../../../store/manager.js'
import { colorEnabled, colorScheme } from '../../../sys/io/color.js'

export type LogoutOptions = {
  readonly io: IOStreams
  readonly reg: Registry
  readonly http?: KyInstance
  /** Optional override for tests; production resolves via `getTokenStore`. */
  readonly store?: Store
}

const REVOCABLE_PREFIXES = ['dfoa_', 'dfoe_'] as const

export async function runLogout(opts: LogoutOptions): Promise<void> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const reg = opts.reg
  const active = reg.requireActive()

  const store = opts.store ?? getTokenStore().store
  const bearer = store.get(tokenKey(active.host, active.email))

  let revokeWarning = ''
  if (bearer !== '' && revokeAllowed(bearer) && opts.http !== undefined) {
    try {
      await new AccountSessionsClient(opts.http).revokeSelf()
    }
    catch (err) {
      revokeWarning = `${cs.warningIcon()} server revoke failed (${(err as Error).message}); local credentials cleared anyway\n`
    }
  }

  reg.forget(active, store)

  if (revokeWarning !== '')
    opts.io.err.write(revokeWarning)
  opts.io.out.write(`${cs.successIcon()} Logged out of ${active.host}\n`)
}

function revokeAllowed(bearer: string): boolean {
  return REVOCABLE_PREFIXES.some(p => bearer.startsWith(p))
}
