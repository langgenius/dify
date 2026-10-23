import type { CommandContext } from '@/plugins/base'
import type { Login } from '@/plugins/session'
import type { Hint } from '@/protocol/hint'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { catalog } from '@/plugins/catalog'
import { http } from '@/plugins/http'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'
import { COMMAND_SEPARATOR, spacedId } from '@/protocol/op-id'
import { flagToken } from '@/util/flag-name'
import { BINARY } from '@/version/info'

const SESSIONS_SELF_PATH = '/openapi/v1/account/sessions/self'
const REVOKE_FAILED_PREFIX = 'server revoke failed: '
const LIST_SESSIONS_OP = 'get.account.session'
const DELETE_SESSION_OP = 'delete.account.session'
const REVOKE_ELSEWHERE_SUMMARY = 'revoke it from another login'

type RevokeHint = Hint & { input?: Readonly<Record<string, string>> }

export type RevokeOutcome = Readonly<
  { revoked: true } | { revoked: false; revoke_error: string; hints: RevokeHint[] }
>

// The session commands accept only account logins, so an external-SSO login gets no hint.
function revokeElsewhereHints(login: Login): RevokeHint[] {
  if (login.account === null) return []
  if (login.sessionId === null)
    return [
      { summary: 'find the id of this session', op: LIST_SESSIONS_OP },
      { summary: REVOKE_ELSEWHERE_SUMMARY, op: DELETE_SESSION_OP },
    ]
  return [
    {
      summary: REVOKE_ELSEWHERE_SUMMARY,
      op: DELETE_SESSION_OP,
      input: { session_id: login.sessionId },
    },
  ]
}

function hintNotice(hint: RevokeHint): string {
  const flags = Object.entries(hint.input ?? {}).flatMap(([name, value]) => [
    flagToken(name),
    value,
  ])
  return `${hint.summary}: ${[BINARY, spacedId(hint.op), ...flags].join(COMMAND_SEPARATOR)}`
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
      const failed = {
        revoked: false,
        revoke_error: errorMessage(err),
        hints: revokeElsewhereHints(login),
      } as const
      streams.notice(`${REVOKE_FAILED_PREFIX}${failed.revoke_error}`)
      for (const hint of failed.hints) streams.notice(hintNotice(hint))
      outcome = failed
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
