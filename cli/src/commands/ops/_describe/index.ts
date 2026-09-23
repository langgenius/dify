import type { CommandContext } from '@/plugins/base'
import { z } from 'zod'
import { Command } from '@/plugins/commands/command'
import { ops } from '@/plugins/ops'

const INPUT = z.object({ op_id: z.string().describe('Catalog operation id') })

export default class OpsDescribe extends Command<typeof INPUT> {
  static override summary = 'Show one operation: its input schema, usage line and pinned values'
  static override input = INPUT
  static override positional = ['op_id'] as const
  static override examples = [
    { title: 'Describe the workflow run', input: { op_id: 'console_app.workflow.run' } },
  ]

  async run(input: z.infer<typeof INPUT>, ctx: CommandContext) {
    return (await ctx.get(ops)).describe(input.op_id)
  }
}
