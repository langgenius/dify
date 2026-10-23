import type { CommandContext } from '@/plugins/base'
import type { Login } from '@/plugins/session'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { catalog } from '@/plugins/catalog'
import { http } from '@/plugins/http'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'

const SESSIONS_SELF_PATH = '/openapi/v1/account/sessions/self'
const REVOKE_FAILED_PREFIX = 'server revoke failed: '
const REVOKE_ELSEWHERE_PREFIX = 'revoke it from another login: '

export type RevokeOutcome = Readonly<{ revoked: true } | { revoked: false; error: string }>

// The session commands accept only account logins, so an external-SSO login gets no hint.
function revokeElsewhereHint(login: Login): string | undefined {
  if (login.account === null) return undefined
  if (login.sessionId === null)
    return `${REVOKE_ELSEWHERE_PREFIX}difyctl get account session, then delete account session`
  return `${REVOKE_ELSEWHERE_PREFIX}difyctl delete account session --session-id ${login.sessionId}`
}

/** Throws when the current login comes from DIFY_SERVER/DIFY_TOKEN, which neither
 * login nor logout may touch — each passes its own explanation. */
export function assertNotEnvLogin(fromEnv: boolean, message: string): void {
  if (fromEnv) throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message })
}

// A 401 means the token is no longer a live session: there is nothing left to revoke.
function alreadyRevoked(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false
  return err.code === ErrorCode.AuthExpired
}

// Shared by `login` (replacing the previous session once a new login succeeds)
// and `logout` itself: best-effort server-side revoke, then unconditional local
// cleanup of the token, the cached catalog and the session pin.
//
// catalog.clear() must run before session.clear(): the catalog plugin resolves
// its cache-file path from session.current() the first time it is built, so
// clearing the session first leaves it unable to find its own file.
export async function revokeAndClearSession(
  ctx: CommandContext,
  login: Login,
): Promise<RevokeOutcome> {
  const streams = await ctx.get(io)
  const httpService = await ctx.get(http)
  let outcome: RevokeOutcome = { revoked: true }
  try {
    await httpService.request(() => ({ method: 'DELETE', path: SESSIONS_SELF_PATH }))
  } catch (err) {
    if (!alreadyRevoked(err)) {
      outcome = { revoked: false, error: errorMessage(err) }
      streams.notice(`${REVOKE_FAILED_PREFIX}${outcome.error}`)
      const hint = revokeElsewhereHint(login)
      if (hint !== undefined) streams.notice(hint)
    }
  }

  const tokenService = await ctx.get(token)
  await tokenService.remove(login)

  const catalogService = await ctx.get(catalog)
  await catalogService.clear()

  const sessionService = await ctx.get(session)
  await sessionService.clear()
  return outcome
}
