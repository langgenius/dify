import { definePlugin } from '@/kernel/plugin'
import { argv } from '@/plugins/argv'
import { inputSchema, parseArgv, partitionArgv } from '@/plugins/argv/parse'
import { ENV } from '@/plugins/env'
import { GLOBAL_INPUT } from '@/plugins/global-flags'
import { env as processEnv, io as processIo } from '@/sys'

export const OutputMode = { Json: 'json', Text: 'text' } as const
export type OutputModeValue = (typeof OutputMode)[keyof typeof OutputMode]
export type OutputService = Readonly<{ out: OutputModeValue; err: OutputModeValue }>

type TTYFlags = Readonly<{ isOutTTY: boolean; isErrTTY: boolean }>
type ResolveInput = Readonly<{ argv: readonly string[]; env: NodeJS.ProcessEnv; streams: TTYFlags }>

const MODES: readonly string[] = Object.values(OutputMode)

// Only the `json` field of GLOBAL_INPUT, so --json is recognized exactly as
// global-flags recognizes it (honors --, accepts --json=false/=true).
const JSON_FLAG_SCHEMA = inputSchema(GLOBAL_INPUT.pick({ json: true }))

function jsonFlag(tokens: readonly string[]): boolean {
  const { matched } = partitionArgv(tokens, JSON_FLAG_SCHEMA)
  return parseArgv(matched, { positional: [], schema: JSON_FLAG_SCHEMA }).json === true
}

function forced(input: ResolveInput): OutputModeValue | undefined {
  if (jsonFlag(input.argv)) return OutputMode.Json
  const fromEnv = input.env[ENV.Output]
  return fromEnv !== undefined && MODES.includes(fromEnv) ? (fromEnv as OutputModeValue) : undefined
}

function fromTTY(isTTY: boolean): OutputModeValue {
  return isTTY ? OutputMode.Text : OutputMode.Json
}

export function resolveOutput(input: ResolveInput): OutputService {
  const fixed = forced(input)
  return Object.freeze({
    out: fixed ?? fromTTY(input.streams.isOutTTY),
    err: fixed ?? fromTTY(input.streams.isErrTTY),
  })
}

// Reads argv tolerantly on purpose: this plugin must never throw, because io
// depends on it and io is what prints a flag error.
export const output = definePlugin({
  name: 'output',
  needs: [argv],
  build: async (ctx): Promise<OutputService> =>
    resolveOutput({ argv: await ctx.get(argv), env: processEnv(), streams: processIo() }),
})
