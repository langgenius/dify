import type { JsonSchema } from '@/plugins/catalog'
import type { Kind } from '@/protocol/kinds'
import { z } from 'zod'
import { inputSchema } from '@/plugins/argv/parse'
import { isKind, KIND, KINDS } from '@/protocol/kinds'

export const CALL_FLAG = {
  Input: 'input',
  Stream: 'stream',
  Only: 'only',
  Output: 'output',
} as const

export type CallFlag = (typeof CALL_FLAG)[keyof typeof CALL_FLAG]

type FlagSpec<S extends z.ZodType> = Readonly<{ schema: S; kinds: readonly Kind[] }>

function flag<S extends z.ZodType>(schema: S, kinds: readonly Kind[]): FlagSpec<S> {
  return { schema, kinds }
}

export const CALL_FLAGS = {
  [CALL_FLAG.Input]: flag(
    z.string().optional().describe('Operation input as JSON, @file or @- for stdin'),
    KINDS,
  ),
  [CALL_FLAG.Stream]: flag(z.boolean().optional().describe('Print each event as it arrives'), [
    KIND.Sse,
  ]),
  [CALL_FLAG.Only]: flag(
    z.array(z.string()).optional().describe('Keep only these streamed events'),
    [KIND.Sse],
  ),
  [CALL_FLAG.Output]: flag(z.string().optional().describe('Write the downloaded file here'), [
    KIND.File,
  ]),
} as const

type SchemasOf<T extends Record<string, FlagSpec<z.ZodType>>> = { [K in keyof T]: T[K]['schema'] }

function schemasOf<T extends Record<string, FlagSpec<z.ZodType>>>(table: T): SchemasOf<T> {
  return Object.fromEntries(
    Object.entries(table).map(([name, spec]) => [name, spec.schema]),
  ) as SchemasOf<T>
}

export const CALL_FLAG_SCHEMA = z.object(schemasOf(CALL_FLAGS))

export type CallFlags = z.infer<typeof CALL_FLAG_SCHEMA>

const CALL_FLAG_NAMES = Object.keys(CALL_FLAGS) as readonly CallFlag[]

// An unknown kind is rendered — and so flagged — as an object.
function renderedKind(kind: string): Kind {
  return isKind(kind) ? kind : KIND.Object
}

export function unsupportedFlags(kind: string, flags: CallFlags): CallFlag[] {
  const renderedAs = renderedKind(kind)
  return CALL_FLAG_NAMES.filter(
    (name) => flags[name] !== undefined && !CALL_FLAGS[name].kinds.includes(renderedAs),
  )
}

/** The call flags an operation of this kind accepts, as a JSON Schema. */
export function callOptionsSchema(kind: string): JsonSchema {
  const renderedAs = renderedKind(kind)
  const shape = Object.fromEntries(
    Object.entries(CALL_FLAGS)
      .filter(([, spec]) => spec.kinds.includes(renderedAs))
      .map(([name, spec]) => [name, spec.schema]),
  )
  return inputSchema(z.object(shape))
}
