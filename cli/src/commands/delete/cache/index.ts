import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { catalog } from '@/plugins/catalog'
import { Command } from '@/plugins/commands/command'

const INPUT = z.object({})

export default class CacheClear extends Command<typeof INPUT> {
  static override summary = 'Delete the local server catalog cache'
  static override effect = 'write' as const
  static override input = INPUT

  async run(_input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const catalogService = await ctx.get(catalog)
    await catalogService.clear()
    return { cleared: true }
  }
}
