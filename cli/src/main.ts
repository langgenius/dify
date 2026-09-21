import type { Override } from '@/kernel/context'
import { printEnvelope } from '@/errors/envelope'
import { Context } from '@/kernel/context'
import { argv } from '@/plugins/argv'
import { commands } from '@/plugins/commands'
import { globalFlags } from '@/plugins/global-flags'
import { io } from '@/plugins/io'

export async function main(
  args: readonly string[],
  overrides: Iterable<Override> = [],
  ctx = new Context([...overrides, [argv, args]]),
): Promise<number> {
  const { streams } = await ctx.get(io)
  let code: number
  let verbose = false
  try {
    verbose = (await ctx.get(globalFlags)).flags.verbose
    code = await (await ctx.get(commands)).run()
  } catch (err) {
    code = printEnvelope(err, streams, { verbose })
  } finally {
    for (const fn of [...ctx.deferred].reverse()) {
      try {
        await fn()
      } catch {
        /* cleanup never masks the command's outcome */
      }
    }
  }
  return code
}
