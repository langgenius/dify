import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { assertNotEnvLogin } from '@/auth/logout'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Command } from '@/plugins/commands/command'
import { env } from '@/plugins/env'
import { session } from '@/plugins/session'

const INPUT = z.object({ workspace_id: z.string().min(1) })

const ENV_WORKSPACE_ID_MESSAGE = 'DIFY_WORKSPACE_ID is set; unset it to pin locally'
const ENV_LOGIN_MESSAGE = 'the login comes from DIFY_TOKEN; set DIFY_WORKSPACE_ID instead'

export default class WorkspaceUse extends Command<typeof INPUT> {
  static override summary = 'Pin the local session to a workspace'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['workspace_id'] as const

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const envService = await ctx.get(env)
    if (envService.workspaceId !== undefined) {
      throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: ENV_WORKSPACE_ID_MESSAGE })
    }

    const sessionService = await ctx.get(session)
    const login = await sessionService.require()
    assertNotEnvLogin(sessionService.fromEnv, ENV_LOGIN_MESSAGE)

    await sessionService.save({ ...login, workspaceId: input.workspace_id })

    return { workspace_id: input.workspace_id }
  }
}
