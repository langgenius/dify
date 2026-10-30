import type { CommandContext } from '@/plugins/base'
import type { HttpRequest } from '@/plugins/http'
import type { Login } from '@/plugins/session'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { http } from '@/plugins/http'

// The cheapest call each kind of login is allowed to make.
const ACCOUNT_PROBE: HttpRequest = { method: 'GET', path: '/openapi/v1/account' }
const EXTERNAL_SSO_PROBE: HttpRequest = {
  method: 'GET',
  path: '/openapi/v1/permitted-external-apps',
  query: { page: '1', limit: '1' },
}

const GONE_CODES: readonly string[] = [ErrorCode.AuthExpired, ErrorCode.NotLoggedIn]

/** Whether the saved login's token still works on its server. Any answer other than
 * "works" or "gone" (a 5xx, a network error) is thrown, not guessed. */
export async function savedLoginIsLive(ctx: CommandContext, login: Login): Promise<boolean> {
  const probe = login.account === null ? EXTERNAL_SSO_PROBE : ACCOUNT_PROBE
  try {
    await (await ctx.get(http)).request(() => probe)
    return true
  } catch (err) {
    if (err instanceof BaseError && GONE_CODES.includes(err.code)) return false
    throw err
  }
}
