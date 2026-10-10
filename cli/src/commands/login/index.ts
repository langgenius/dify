import type { PollSuccess } from '@/auth/device-api'
import type { Pending, PendingLoginStore } from '@/auth/pending-login'
import type { CommandContext } from '@/plugins/base'
import type { Login as SavedLogin } from '@/plugins/session'
import { hostname } from 'node:os'
import { z } from 'zod'
import { deviceApi } from '@/auth/device-api'
import { awaitAuthorization, pollAuthorization, realClock } from '@/auth/device-flow'
import { assertNotEnvLogin, revokeAndClearSession } from '@/auth/logout'
import { pendingLoginStore } from '@/auth/pending-login'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Command } from '@/plugins/commands/command'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'
import { decideOpen, OpenDecision, openUrl, realEnv } from '@/util/browser'
import { resolveHost, validateVerificationURI } from '@/util/host'

const INPUT = z.object({
  server: z
    .string()
    .trim()
    .optional()
    .describe('Dify server base URL. Required to start a login; there is no default'),
  no_browser: z
    .boolean()
    .default(false)
    .describe('Do not open a browser; print the URL and code for the user'),
  no_keyring: z
    .boolean()
    .default(false)
    .describe(
      'Keep the token in tokens.yml under the config dir instead of the OS keyring. Use in a sandbox, with DIFY_CONFIG_DIR on persistent storage',
    ),
  insecure: z
    .boolean()
    .default(false)
    .describe('Skip TLS verification and allow http:// (local dev only)'),
  no_wait: z
    .boolean()
    .default(false)
    .describe('Print the URL and code, save the pending login, and exit without waiting'),
  resume: z
    .boolean()
    .default(false)
    .describe(
      'Check a login started with --no-wait once. Prints status pending until the user approves. With no pending login, prints the saved login, or fails with not_logged_in',
    ),
})

const PENDING_STATUS = 'pending'
const FINAL_POLL_ERRORS: readonly string[] = [ErrorCode.AuthExpired, ErrorCode.AccessDenied]

const ENV_LOGIN_MESSAGE = 'unset DIFY_TOKEN to log in interactively'
const NO_EMAIL_MESSAGE = 'login response carries no account or subject email'
const NO_SERVER_MESSAGE = 'pass --server <url>: the Dify server to log in to'
const NO_SERVER_HINT = 'ask the user which server; Dify Cloud is https://cloud.dify.ai'

// A present-but-empty email is the same as absent: neither account.email nor
// subject_email is meaningful until it has a value.
function meaningfulEmail(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

export default class Login extends Command<typeof INPUT> {
  static override summary =
    'Log in via the OAuth device flow. Agents: use --no-wait, then --resume after the user approves'
  static override effect = 'write' as const
  static override input = INPUT
  static override examples = [
    {
      title: 'Agent: start without waiting, give the user the url and code, then end the turn',
      input: { server: 'https://dify.example.com', no_browser: true, no_wait: true },
    },
    {
      title: 'Agent in a sandbox: add --no-keyring and point DIFY_CONFIG_DIR at persistent storage',
      input: {
        server: 'https://dify.example.com',
        no_browser: true,
        no_wait: true,
        no_keyring: true,
      },
    },
    {
      title: 'Finish a --no-wait login once the user says they approved',
      input: { resume: true },
    },
  ]

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const pendingLogin = await pendingLoginStore(ctx)
    if (input.resume) return resume(ctx, pendingLogin)

    const sessionService = await ctx.get(session)
    assertNotEnvLogin(sessionService.fromEnv, ENV_LOGIN_MESSAGE)
    if (input.server === undefined || input.server === '')
      throw new BaseError({
        code: ErrorCode.UsageMissingArg,
        message: NO_SERVER_MESSAGE,
        hint: NO_SERVER_HINT,
      })

    const server = resolveHost({ raw: input.server, insecure: input.insecure })
    const streams = await ctx.get(io)

    const current = await sessionService.current()
    if (current !== null) {
      await revokeAndClearSession(ctx, current)
      streams.notice(`logged out ${current.email} from ${current.server}`)
    }

    const api = deviceApi(server, { insecure: input.insecure })
    const code = await api.requestCode({ device_label: hostname() })
    // Checked before it is printed: a URI difyctl would refuse to open is one the
    // operator should not be invited to paste either.
    validateVerificationURI(code.verification_uri, input.insecure)
    streams.notice(`open ${code.verification_uri}`)
    streams.notice(`code ${code.user_code}`)

    const decision = decideOpen(realEnv(), input.no_browser)
    if (decision === OpenDecision.Auto) await openUrl(code.verification_uri)

    const pending: Pending = {
      server,
      insecure: input.insecure,
      no_keyring: input.no_keyring,
      device_code: code.device_code,
    }
    if (input.no_wait) {
      await pendingLogin.save(pending)
      return {
        status: PENDING_STATUS,
        verification_uri: code.verification_uri,
        user_code: code.user_code,
        expires_in: code.expires_in,
      }
    }

    await pendingLogin.clear()
    const success = await awaitAuthorization(api, code, { clock: realClock() })
    return finish(ctx, pending, success)
  }
}

function loginReport(login: SavedLogin) {
  return {
    server: login.server,
    email: login.email,
    account: login.account,
    workspace_id: login.workspaceId,
  }
}

// `get` throws not_logged_in when the saved login's token is gone from the store.
async function assertTokenSaved(ctx: CommandContext): Promise<void> {
  await (await ctx.get(token)).get()
}

async function resume(ctx: CommandContext, pendingLogin: PendingLoginStore) {
  const sessionService = await ctx.get(session)
  const pending = await pendingLogin.read()
  if (pending === undefined) {
    const current = await sessionService.require()
    await assertTokenSaved(ctx)
    return loginReport(current)
  }
  assertNotEnvLogin(sessionService.fromEnv, ENV_LOGIN_MESSAGE)
  const api = deviceApi(pending.server, { insecure: pending.insecure })
  let success: PollSuccess | undefined
  try {
    success = await pollAuthorization(api, pending.device_code, { clock: realClock() })
  } catch (err) {
    if (err instanceof BaseError && FINAL_POLL_ERRORS.includes(err.code)) await pendingLogin.clear()
    throw err
  }
  if (success === undefined) return { status: PENDING_STATUS }
  const result = await finish(ctx, pending, success)
  await pendingLogin.clear()
  return result
}

async function finish(ctx: CommandContext, pending: Pending, success: PollSuccess) {
  const sessionService = await ctx.get(session)
  const tokenService = await ctx.get(token)
  const tokenStorage = await tokenService.detect({ skipKeyring: pending.no_keyring })
  const email = meaningfulEmail(success.account?.email) ?? meaningfulEmail(success.subject_email)
  if (email === undefined) {
    throw new BaseError({ code: ErrorCode.ServerError, message: NO_EMAIL_MESSAGE })
  }

  const login: SavedLogin = {
    server: pending.server,
    email,
    account: success.account ?? null,
    workspaceId: success.default_workspace_id ?? null,
    tokenStorage,
    insecure: pending.insecure,
  }

  await sessionService.save(login)
  await tokenService.write(login, success.token)
  return loginReport(login)
}
