import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { config } from '@/plugins/config'

const INPUT = z.object({ key: z.string() })

export default class ConfigUnset extends Command<typeof INPUT> {
  static override summary = 'Remove a local config value, restoring its default'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['key'] as const

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const configService = await ctx.get(config)
    await configService.unset(input.key)
    return undefined
  }
}
