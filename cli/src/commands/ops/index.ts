import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { ops } from '@/plugins/ops'

const INPUT = z.object({
  all: z.boolean().default(false).describe('Include operations the server marks internal'),
})

// Superseded by the help map, which lists ops and statics as one tree.
export default class Ops extends Command<typeof INPUT> {
  static override summary = 'List the operations this server exposes'
  static override hidden = true
  static override input = INPUT

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    return { ops: await (await ctx.get(ops)).list({ includeInternal: input.all }) }
  }
}
