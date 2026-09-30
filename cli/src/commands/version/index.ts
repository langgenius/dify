import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { parseJsonBody } from '@/call/json-body'
import { errorMessage } from '@/errors/message'
import { Command } from '@/plugins/commands/command'
import { http } from '@/plugins/http'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { versionInfo } from '@/version/info'

const INPUT = z.object({})
const SERVER_VERSION_PATH = '/openapi/v1/_version'
const SERVER_VERSION_UNAVAILABLE_PREFIX = 'server version unavailable: '

type ServerVersion = { version: string; edition: string }

export default class Version extends Command<typeof INPUT> {
  static override summary = 'Print the client and server versions'
  static override input = INPUT

  async run(_input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const client = {
      version: versionInfo.version,
      commit: versionInfo.commit,
      channel: versionInfo.channel,
      build_date: versionInfo.buildDate,
    }
    const login = await (await ctx.get(session)).current()
    if (login === null) return { client }

    const streams = await ctx.get(io)
    const httpService = await ctx.get(http)
    try {
      const res = await httpService.request(() => ({
        method: 'GET',
        path: SERVER_VERSION_PATH,
        auth: false,
      }))
      const body = (await parseJsonBody(res)) as ServerVersion
      return { client, server: { version: body.version, edition: body.edition } }
    } catch (err) {
      streams.notice(`${SERVER_VERSION_UNAVAILABLE_PREFIX}${errorMessage(err)}`)
      return { client, server: null }
    }
  }
}
