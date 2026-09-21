import type { CommandContext } from '@/plugins/base'
import type { CatalogOp } from '@/plugins/catalog'
import type { HelpArgs } from '@/plugins/commands/command'
import type { Printable } from '@/plugins/io'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { readLocalFile } from '@/call/files'
import { CALL_FLAG_SCHEMA, unsupportedFlags } from '@/call/flags'
import { applyPins, loadInput } from '@/call/input'
import { rendererFor } from '@/call/render/index'
import { buildRequest } from '@/call/request'
import { validateInput } from '@/call/validate'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { runSignal } from '@/plugins/commands/cancel'
import { Command, Outcome } from '@/plugins/commands/command'
import { http } from '@/plugins/http'
import { io } from '@/plugins/io'
import { ops } from '@/plugins/ops'
import { session } from '@/plugins/session'
import { KIND } from '@/protocol/kinds'
import { PIN } from '@/protocol/pins'

const INPUT = z.object({
  op_id: z.string().describe('Catalog operation id'),
  ...CALL_FLAG_SCHEMA.shape,
})

type CallInput = z.infer<typeof INPUT>

const FLAG_PREFIX = '-'
const FILE_ENCODING = 'utf8'
const DEPRECATED_NOTICE = 'deprecated'
const ONLY_NEEDS_STREAM = '--only requires --stream'

function assertSupportedFlags(kind: string, input: CallInput): void {
  const [refused] = unsupportedFlags(kind, input)
  if (refused !== undefined) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `--${refused} is not supported by ${kind} operations`,
    })
  }
  // --only filters the events --stream emits; on its own it filters nothing.
  if (input.only !== undefined && input.stream !== true)
    throw new BaseError({ code: ErrorCode.UsageInvalidFlag, message: ONLY_NEEDS_STREAM })
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  stream.setEncoding(FILE_ENCODING)
  let text = ''
  for await (const chunk of stream) text += chunk
  return text
}

function assertValidInput(op: CatalogOp, opId: string, input: Record<string, unknown>): void {
  const details = validateInput(op.input, input)
  if (details.length === 0) return
  throw new BaseError({
    code: ErrorCode.InputInvalid,
    message: `invalid input for "${opId}"`,
    details: [...details],
    schema: op.input,
  })
}

export default class Call extends Command<typeof INPUT> {
  static override summary = 'Call any catalog operation by id'
  static override effect = 'write' as const
  static override input = INPUT
  static override positional = ['op_id'] as const
  static override examples = [
    {
      title: 'Run a workflow app',
      input: { op_id: 'console_app.workflow.run', input: '{"app_id":"…","inputs":{}}' },
    },
  ]

  static override async help(args: HelpArgs): Promise<Printable> {
    const target = args.rest[0]
    if (target === undefined || target.startsWith(FLAG_PREFIX)) return super.help(args)
    return (await args.ctx.get(ops)).describe(target)
  }

  async run(input: CallInput, ctx: CommandContext) {
    const op = await (await ctx.get(ops)).resolve(input.op_id)
    assertSupportedFlags(op.kind, input)

    const out = await ctx.get(io)
    const raw = await loadInput({
      raw: input.input,
      stdin: () => readAll(out.streams.in),
      readFile: (path) => readFile(path, FILE_ENCODING),
    })
    const workspaceId = await (await ctx.get(session)).workspaceId()
    const body = applyPins(raw, op.input, { [PIN.Workspace]: workspaceId })
    assertValidInput(op, input.op_id, body)

    if (op.deprecated) out.notice(`${DEPRECATED_NOTICE}: ${input.op_id}`)

    // SIGINT cancels the whole invocation; this controller ends only this call's stream.
    const call = new AbortController()
    if (op.kind === KIND.Sse) ctx.defer(() => call.abort())
    const signal = AbortSignal.any([runSignal(), call.signal])

    const res = await (
      await ctx.get(http)
    ).request(async (cat) => ({
      ...(await buildRequest(cat.opOrThrow(input.op_id), body, { readFile: readLocalFile })),
      signal,
    }))

    const code = await rendererFor(op.kind, out)(res, out, input, input.op_id)
    return new Outcome(code)
  }
}
