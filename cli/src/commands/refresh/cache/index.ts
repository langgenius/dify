import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { catalog } from '@/plugins/catalog'
import { Command } from '@/plugins/commands/command'
import { http } from '@/plugins/http'

const INPUT = z.object({})

export default class CacheRefresh extends Command<typeof INPUT> {
  static override summary = 'Refetch the server catalog and replace the local cache'
  static override effect = 'write' as const
  static override input = INPUT

  async run(_input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const httpService = await ctx.get(http)
    const catalogService = await ctx.get(catalog)
    await catalogService.replace(await httpService.fetchCatalog())

    return {
      ops: Object.keys(catalogService.ops()).length,
      fingerprint: catalogService.fingerprint,
      path: catalogService.path,
    }
  }
}
