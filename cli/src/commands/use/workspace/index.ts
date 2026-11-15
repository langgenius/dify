import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { assertNotEnvLogin } from '@/auth/logout'
import { LOCAL_FILES } from '@/call/files'
import { parseJsonBody } from '@/call/json-body'
import { buildRequest } from '@/call/request'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Command } from '@/plugins/commands/command'
import { env } from '@/plugins/env'
import { http } from '@/plugins/http'
import { session } from '@/plugins/session'

const INPUT = z.object({ workspace_id: z.string().min(1) })
const WORKSPACE = z.object({ id: z.string(), name: z.string() })

const WORKSPACE_DESCRIBE_OP = 'describe.workspace'
const ENV_WORKSPACE_ID_MESSAGE = 'DIFY_WORKSPACE_ID is set; unset it to pin locally'
const ENV_LOGIN_MESSAGE = 'the login comes from DIFY_TOKEN; set DIFY_WORKSPACE_ID instead'
const MALFORMED_WORKSPACE_MESSAGE = 'describe workspace response has no id and name'

export default class WorkspaceUse extends Command<typeof INPUT> {
  static override summary =
    'Pin this device to a workspace; the web console keeps its own current workspace'
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

    // Check membership first so a mistyped id is never pinned.
    const httpService = await ctx.get(http)
    const res = await httpService.request(async (cat) =>
      buildRequest(
        cat.opOrThrow(WORKSPACE_DESCRIBE_OP),
        { workspace_id: input.workspace_id },
        LOCAL_FILES,
      ),
    )
    const workspace = WORKSPACE.safeParse(await parseJsonBody(res))
    if (!workspace.success)
      throw new BaseError({ code: ErrorCode.ServerError, message: MALFORMED_WORKSPACE_MESSAGE })

    await sessionService.save({ ...login, workspaceId: workspace.data.id })

    return { workspace_id: workspace.data.id, name: workspace.data.name }
  }
}
