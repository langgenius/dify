import type { PollSuccess } from '@/auth/device-api'
import type { CommandContext } from '@/plugins/base'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { deviceApi } from '@/auth/device-api'
import { awaitAuthorization, pollAuthorization, realClock } from '@/auth/device-flow'
import { assertNotEnvLogin, revokeAndClearSession } from '@/auth/logout'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Command } from '@/plugins/commands/command'
import { env } from '@/plugins/env'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'
import { YamlStore } from '@/store/store'
import { decideOpen, OpenDecision, openUrl, realEnv } from '@/util/browser'
import { DEFAULT_HOST, resolveHost, validateVerificationURI } from '@/util/host'

const INPUT = z.object({
  server: z.string().default(DEFAULT_HOST).describe('Dify server base URL'),
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
      'Check a login started with --no-wait once. Prints status pending until the user approves',
    ),
})

const PENDING_FILE_NAME = 'login-pending.yml'
const PENDING_STATUS = 'pending'
const PENDING_SCHEMA = z.object({
  server: z.string(),
  insecure: z.boolean(),
  no_keyring: z.boolean(),
  device_code: z.string(),
})
type Pending = z.infer<typeof PENDING_SCHEMA>
const NO_PENDING_MESSAGE = 'no pending login; start one with login --no-wait'
const FINAL_POLL_ERRORS: readonly string[] = [ErrorCode.AuthExpired, ErrorCode.AccessDenied]

const ENV_LOGIN_MESSAGE = 'unset DIFY_TOKEN to log in interactively'
const NO_EMAIL_MESSAGE = 'login response carries no account or subject email'

// A present-but-empty email is the same as absent: neither account.email nor
// subject_email is meaningful until it has a value.
function meaningfulEmail(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

export default class Login extends Command<typeof INPUT> {
  static override summary =
    'Log in via the OAuth device flow. Blocks until approval: run it in the background, never cancel it'
  static override effect = 'write' as const
  static override input = INPUT
  static override examples = [
    {
      title: 'Agent: run in the background, relay the url and code to the user, do not cancel',
      input: { server: 'https://dify.example.com', no_browser: true },
    },
    {
      title: 'Agent in a sandbox: add --no-keyring and point DIFY_CONFIG_DIR at persistent storage',
      input: { server: 'https://dify.example.com', no_browser: true, no_keyring: true },
    },
    {
      title: 'Agent that cannot keep a process alive: start without waiting',
      input: { server: 'https://dify.example.com', no_browser: true, no_wait: true },
    },
    {
      title: 'Then, after the user approves, finish the login (repeat while status is pending)',
      input: { resume: true },
    },
  ]

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const sessionService = await ctx.get(session)
    assertNotEnvLogin(sessionService.fromEnv, ENV_LOGIN_MESSAGE)

    const { configDir } = await ctx.get(env)
    const pendingStore = new YamlStore(join(configDir, PENDING_FILE_NAME))
    if (input.resume) return resume(ctx, pendingStore)

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
      await pendingStore.setTyped(pending)
      return {
        status: PENDING_STATUS,
        verification_uri: code.verification_uri,
        user_code: code.user_code,
        expires_in: code.expires_in,
      }
    }

    const success = await awaitAuthorization(api, code, { clock: realClock() })
    return finish(ctx, pending, success)
  }
}

async function resume(ctx: CommandContext, pendingStore: YamlStore) {
  const parsed = PENDING_SCHEMA.safeParse(await pendingStore.getTyped<unknown>())
  if (!parsed.success) {
    throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: NO_PENDING_MESSAGE })
  }
  const pending = parsed.data
  const api = deviceApi(pending.server, { insecure: pending.insecure })
  let success: PollSuccess | undefined
  try {
    success = await pollAuthorization(api, pending.device_code, { clock: realClock() })
  } catch (err) {
    if (err instanceof BaseError && FINAL_POLL_ERRORS.includes(err.code)) await pendingStore.rm()
    throw err
  }
  if (success === undefined) return { status: PENDING_STATUS }
  const result = await finish(ctx, pending, success)
  await pendingStore.rm()
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

  const login = {
    server: pending.server,
    email,
    account: success.account ?? null,
    workspaceId: success.default_workspace_id ?? null,
    tokenStorage,
    insecure: pending.insecure,
  }

  await sessionService.save(login)
  await tokenService.write(login, success.token)

  return {
    server: pending.server,
    email,
    account: login.account,
    workspace_id: login.workspaceId,
  }
}
