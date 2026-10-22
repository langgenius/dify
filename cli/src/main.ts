import type { Override } from '@/kernel/context'
import { HttpClientError } from '@/errors/base'
import { printEnvelope } from '@/errors/envelope'
import { Context } from '@/kernel/context'
import { argv } from '@/plugins/argv'
import { commands } from '@/plugins/commands'
import { globalFlags } from '@/plugins/global-flags'
import { io } from '@/plugins/io'

async function nextCommandsFor(err: unknown, ctx: Context): Promise<readonly string[] | undefined> {
  if (!(err instanceof HttpClientError)) return undefined
  const hints = err.serverError?.hints
  if (hints === undefined || hints.length === 0) return undefined
  try {
    return await (await ctx.get(commands)).hintCommands(hints)
  } catch {
    return undefined
  }
}

export async function main(
  args: readonly string[],
  overrides: Iterable<Override> = [],
  ctx = new Context([...overrides, [argv, args]]),
): Promise<number> {
  const ioService = await ctx.get(io)
  let code: number
  let verbose = false
  try {
    verbose = (await ctx.get(globalFlags)).flags.verbose
    code = await (await ctx.get(commands)).run()
  } catch (err) {
    code = await printEnvelope(err, ioService, {
      verbose,
      nextCommands: await nextCommandsFor(err, ctx),
    })
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
