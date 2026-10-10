import type { CommandContext } from '@/plugins/base'
import type { Login } from '@/plugins/session'
import { join } from 'node:path'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { errorMessage } from '@/errors/message'
import { catalog } from '@/plugins/catalog'
import { env } from '@/plugins/env'
import { http } from '@/plugins/http'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'
import { YamlStore } from '@/store/store'

const SESSIONS_SELF_PATH = '/openapi/v1/account/sessions/self'
const REVOKE_FAILED_PREFIX = 'server revoke failed: '
export const PENDING_FILE_NAME = 'login-pending.yml'

/** The device code a `login --no-wait` saved for `login --resume` to finish. */
export async function pendingLoginStore(ctx: CommandContext): Promise<YamlStore> {
  const { configDir } = await ctx.get(env)
  return new YamlStore(join(configDir, PENDING_FILE_NAME))
}

/** Throws when the current login comes from DIFY_SERVER/DIFY_TOKEN, which neither
 * login nor logout may touch — each passes its own explanation. */
export function assertNotEnvLogin(fromEnv: boolean, message: string): void {
  if (fromEnv) throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message })
}

// Shared by `login` (logging out a previous session before starting a new one)
// and `logout` itself: best-effort server-side revoke, then unconditional local
// cleanup of the token, the cached catalog and the session pin.
//
// catalog.clear() must run before session.clear(): the catalog plugin resolves
// its cache-file path from session.current() the first time it is built, so
// clearing the session first leaves it unable to find its own file.
export async function revokeAndClearSession(ctx: CommandContext, login: Login): Promise<void> {
  const streams = await ctx.get(io)
  const httpService = await ctx.get(http)
  try {
    await httpService.request(() => ({ method: 'DELETE', path: SESSIONS_SELF_PATH }))
  } catch (err) {
    streams.notice(`${REVOKE_FAILED_PREFIX}${errorMessage(err)}`)
  }

  const tokenService = await ctx.get(token)
  await tokenService.remove(login)

  const catalogService = await ctx.get(catalog)
  await catalogService.clear()

  const sessionService = await ctx.get(session)
  await sessionService.clear()
}
