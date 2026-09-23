import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { readLocalFile } from '@/call/files'
import { parseJsonBody } from '@/call/json-body'
import { buildRequest } from '@/call/request'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { Command } from '@/plugins/commands/command'
import { http } from '@/plugins/http'
import { session } from '@/plugins/session'
import { isRecord } from '@/util/is-record'

const INPUT = z.object({})

const WORKSPACE_LIST_OP = 'workspace.list'
const NO_DATA_ARRAY_MESSAGE = 'workspace list response has no data array'

type WorkspaceListEnvelope = {
  data: readonly Record<string, unknown>[]
} & Record<string, unknown>

function asEnvelope(body: unknown): WorkspaceListEnvelope {
  if (!isRecord(body) || !Array.isArray(body.data))
    throw new BaseError({ code: ErrorCode.ServerError, message: NO_DATA_ARRAY_MESSAGE })
  return body as WorkspaceListEnvelope
}

export default class WorkspaceList extends Command<typeof INPUT> {
  static override summary = 'List the workspaces visible to the current account'
  static override input = INPUT

  async run(_input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const httpService = await ctx.get(http)
    const res = await httpService.request(async (cat) =>
      buildRequest(cat.opOrThrow(WORKSPACE_LIST_OP), {}, { readFile: readLocalFile }),
    )
    const envelope = asEnvelope(await parseJsonBody(res))

    const sessionService = await ctx.get(session)
    const pinnedId = await sessionService.workspaceId()

    return {
      ...envelope,
      data: envelope.data.map((row) => ({ ...row, pinned: row.id === pinnedId })),
    }
  }
}
