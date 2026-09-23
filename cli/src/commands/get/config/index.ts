import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { config } from '@/plugins/config'

const INPUT = z.object({ key: z.string().optional() })

export default class ConfigGet extends Command<typeof INPUT> {
  static override summary = 'Print the local config, or one key'
  static override input = INPUT
  static override positional = ['key'] as const

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const configService = await ctx.get(config)
    return configService.get(input.key)
  }
}
