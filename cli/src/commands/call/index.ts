import type { CommandContext } from '@/plugins/base'
import type { Descriptor, HelpArgs } from '@/plugins/commands/command'
import { z } from 'zod'
import { executeCall } from '@/call/execute'
import { CALL_FLAG_SCHEMA } from '@/call/flags'
import { Command } from '@/plugins/commands/command'
import { ops } from '@/plugins/ops'

const INPUT = z.object({
  op_id: z.string().describe('Catalog operation id'),
  ...CALL_FLAG_SCHEMA.shape,
})

type CallInput = z.infer<typeof INPUT>

const FLAG_PREFIX = '-'

// The id form of the spaced command an op resolves to: kept for agents and scripts,
// out of the listings the spaced tree already covers.
export default class Call extends Command<typeof INPUT> {
  static override summary = 'Call any catalog operation by id'
  static override effect = 'write' as const
  static override hidden = true
  static override input = INPUT
  static override positional = ['op_id'] as const
  static override examples = [
    {
      title: 'Run a workflow app',
      input: { op_id: 'console_app.workflow.run', input: '{"app_id":"…","inputs":{}}' },
    },
  ]

  // A named op answers with that op's descriptor, not with `call`'s own row.
  static override async help(args: HelpArgs): Promise<Descriptor> {
    const target = args.rest[0]
    if (target === undefined || target.startsWith(FLAG_PREFIX)) return super.help(args)
    return (await args.ctx.get(ops)).describe(target)
  }

  // `call` takes the whole input through --input; an op's own fields are flags only
  // on the command the op adapter builds.
  async run(input: CallInput, ctx: CommandContext) {
    const op = await (await ctx.get(ops)).resolve(input.op_id)
    return executeCall({ id: input.op_id, op, flags: input, fields: {} }, ctx)
  }
}
