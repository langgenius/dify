import { z } from 'zod'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { definePlugin } from '@/kernel/plugin'
import { argv } from '@/plugins/argv'
import { inputSchema, parseArgv, partitionArgv } from '@/plugins/argv/parse'

export const GLOBAL_INPUT = z.object({
  verbose: z.boolean().default(false).describe('Keep the raw server response in error envelopes'),
})

export type GlobalFlags = z.infer<typeof GLOBAL_INPUT>

export type GlobalFlagsService = Readonly<{
  flags: GlobalFlags
  rest: readonly string[]
}>

const NO_POSITIONALS: readonly string[] = []

function invalidGlobalFlags(error: z.ZodError): BaseError {
  const message = error.issues
    .map((issue) => `--${issue.path.join('.')}: ${issue.message}`)
    .join('; ')
  return new BaseError({ code: ErrorCode.UsageInvalidFlag, message, cause: error })
}

export const globalFlags = definePlugin({
  name: 'global-flags',
  needs: [argv],
  build: async (ctx): Promise<GlobalFlagsService> => {
    const schema = inputSchema(GLOBAL_INPUT)
    const { matched, rest } = partitionArgv(await ctx.get(argv), schema)
    const parsed = GLOBAL_INPUT.safeParse(
      parseArgv(matched, { positional: NO_POSITIONALS, schema }),
    )
    if (!parsed.success) throw invalidGlobalFlags(parsed.error)
    return Object.freeze({ flags: parsed.data, rest })
  },
})
