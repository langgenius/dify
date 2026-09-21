import type { CommandContext } from '@/plugins/base'
import { hostname } from 'node:os'
import { z } from 'zod'
import { deviceApi } from '@/auth/device-api'
import { awaitAuthorization, realClock } from '@/auth/device-flow'
import { assertNotEnvLogin, revokeAndClearSession } from '@/auth/logout'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Command } from '@/plugins/commands/command'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { token } from '@/plugins/token'
import { decideOpen, OpenDecision, openUrl, realEnv } from '@/util/browser'
import { DEFAULT_HOST, resolveHost, validateVerificationURI } from '@/util/host'

const INPUT = z.object({
  server: z.string().default(DEFAULT_HOST),
  no_browser: z.boolean().default(false),
  insecure: z.boolean().default(false),
})

const ENV_LOGIN_MESSAGE = 'unset DIFY_TOKEN to log in interactively'
const NO_EMAIL_MESSAGE = 'login response carries no account or subject email'

// A present-but-empty email is the same as absent: neither account.email nor
// subject_email is meaningful until it has a value.
function meaningfulEmail(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

export default class Login extends Command<typeof INPUT> {
  static override summary = 'Log in to a Dify server via the OAuth device flow'
  static override effect = 'write' as const
  static override input = INPUT
  static override examples = [
    {
      title: 'Log in to a self-hosted server',
      input: { server: 'https://dify.example.com', no_browser: true },
    },
  ]

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const sessionService = await ctx.get(session)
    assertNotEnvLogin(sessionService.fromEnv, ENV_LOGIN_MESSAGE)

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

    const success = await awaitAuthorization(api, code, { clock: realClock() })

    const tokenService = await ctx.get(token)
    const tokenStorage = await tokenService.detect()
    const email = meaningfulEmail(success.account?.email) ?? meaningfulEmail(success.subject_email)
    if (email === undefined) {
      throw new BaseError({ code: ErrorCode.ServerError, message: NO_EMAIL_MESSAGE })
    }

    const login = {
      server,
      email,
      account: success.account ?? null,
      workspaceId: success.default_workspace_id ?? null,
      tokenStorage,
      insecure: input.insecure,
    }

    await sessionService.save(login)
    await tokenService.write(login, success.token)

    return { server, email, account: login.account, workspace_id: login.workspaceId }
  }
}
