import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { assertNotEnvLogin, revokeAndClearSession } from '@/auth/logout'
import { Command } from '@/plugins/commands/command'
import { session } from '@/plugins/session'

const INPUT = z.object({})

const ENV_LOGOUT_MESSAGE = 'nothing to log out: the login comes from DIFY_TOKEN'

export default class Logout extends Command<typeof INPUT> {
  static override summary = 'Log out of the current Dify session'
  static override effect = 'write' as const
  static override input = INPUT

  async run(_input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const sessionService = await ctx.get(session)
    const login = await sessionService.require()
    assertNotEnvLogin(sessionService.fromEnv, ENV_LOGOUT_MESSAGE)

    await revokeAndClearSession(ctx, login)

    return { logged_out: true, server: login.server }
  }
}
