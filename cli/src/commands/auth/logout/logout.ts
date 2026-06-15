import type { Registry } from '@/auth/hosts'
import type { HttpClient } from '@/http/types'
import type { TokenStore } from '@/store/token-store'
import type { IOStreams } from '@/sys/io/streams'
import { AccountSessionsClient } from '@/api/account-sessions'
import { getTokenStore } from '@/store/manager'
import { colorEnabled, colorScheme } from '@/sys/io/color'

export type LogoutOptions = {
  readonly io: IOStreams
  readonly reg: Registry
  readonly http?: HttpClient
  /** Optional override for tests; production resolves via `getTokenStore`. */
  readonly store?: TokenStore
}

const REVOCABLE_PREFIXES = ['dfoa_', 'dfoe_'] as const

export async function runLogout(opts: LogoutOptions): Promise<void> {
  const cs = colorScheme(colorEnabled(opts.io.isErrTTY))
  const reg = opts.reg
  const active = reg.requireActive()

  const store = opts.store ?? getTokenStore(reg.token_storage)
  let bearer = ''
  try {
    bearer = await store.read(active.host, active.email)
  }
  catch { /* keyring locked — skip remote revocation, local cleanup still runs */ }

  let revokeWarning = ''
  if (bearer !== '' && revokeAllowed(bearer) && opts.http !== undefined) {
    try {
      await new AccountSessionsClient(opts.http).revokeSelf()
    }
    catch (err) {
      revokeWarning = `${cs.warningIcon()} server revoke failed (${(err as Error).message}); local credentials cleared anyway\n`
    }
  }

  await reg.forget(active, store)

  if (revokeWarning !== '')
    opts.io.err.write(revokeWarning)
  opts.io.out.write(`${cs.successIcon()} Logged out of ${active.host}\n`)
}

function revokeAllowed(bearer: string): boolean {
  return REVOCABLE_PREFIXES.some(p => bearer.startsWith(p))
}
