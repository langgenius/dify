import type { CallFlags } from '@/call/flags'
import type { CommandContext } from '@/plugins/base'
import type { CatalogOp } from '@/plugins/catalog'
import { readFile } from 'node:fs/promises'
import { readLocalFile } from '@/call/files'
import { unsupportedFlags } from '@/call/flags'
import { applyPins, loadInput, resolveFileRefs } from '@/call/input'
import { rendererFor } from '@/call/render/index'
import { buildRequest } from '@/call/request'
import { validateInput } from '@/call/validate'
import { BaseError } from '@/errors/base'
import { ErrorCode } from '@/errors/codes'
import { runSignal } from '@/plugins/commands/cancel'
import { helpHint, Outcome } from '@/plugins/commands/command'
import { http } from '@/plugins/http'
import { io } from '@/plugins/io'
import { session } from '@/plugins/session'
import { KIND } from '@/protocol/kinds'
import { spacedId } from '@/protocol/op-id'
import { PIN } from '@/protocol/pins'

/** One catalog operation, its call flags, and the fields typed as flags of their own. */
export type CallRequest = Readonly<{
  id: string
  op: CatalogOp
  flags: CallFlags
  fields: Record<string, unknown>
}>

const FILE_ENCODING = 'utf8'
const DEPRECATED_NOTICE = 'deprecated'
const ONLY_NEEDS_STREAM = '--only requires --stream'

function assertSupportedFlags(kind: string, flags: CallFlags): void {
  const [refused] = unsupportedFlags(kind, flags)
  if (refused !== undefined) {
    throw new BaseError({
      code: ErrorCode.UsageInvalidFlag,
      message: `--${refused} is not supported by ${kind} operations`,
    })
  }
  // --only filters the events --stream emits; on its own it filters nothing.
  if (flags.only !== undefined && flags.stream !== true)
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
    hint: helpHint(spacedId(opId)),
    details: [...details],
    schema: op.input,
  })
}

export async function executeCall(req: CallRequest, ctx: CommandContext): Promise<Outcome> {
  assertSupportedFlags(req.op.kind, req.flags)

  const out = await ctx.get(io)
  const source = {
    stdin: () => readAll(out.streams.in),
    readFile: (path: string) => readFile(path, FILE_ENCODING),
  }
  const whole = await loadInput({ ...source, raw: req.flags.input })
  const fields = await resolveFileRefs(req.fields, req.op.input, source)
  const workspaceId = await (await ctx.get(session)).workspaceId()
  const body = applyPins({ ...whole, ...fields }, req.op.input, { [PIN.Workspace]: workspaceId })
  assertValidInput(req.op, req.id, body)

  if (req.op.deprecated) out.notice(`${DEPRECATED_NOTICE}: ${req.id}`)

  // SIGINT cancels the whole invocation; this controller ends only this call's stream.
  const call = new AbortController()
  if (req.op.kind === KIND.Sse) ctx.defer(() => call.abort())
  const signal = AbortSignal.any([runSignal(), call.signal])

  const res = await (
    await ctx.get(http)
  ).request(async (cat) => ({
    ...(await buildRequest(cat.opOrThrow(req.id), body, { readFile: readLocalFile })),
    signal,
  }))

  const code = await rendererFor(req.op.kind, out)(res, out, req.flags, req.id)
  return new Outcome(code)
}
