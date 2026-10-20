import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { config } from '@/plugins/config'

const INPUT = z.object({ key: z.string(), value: z.string() })

export default class ConfigSet extends Command<typeof INPUT> {
  static override summary = 'Set a local config value'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['key', 'value'] as const

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    const configService = await ctx.get(config)
    await configService.set(input.key, input.value)
    return undefined
  }
}
