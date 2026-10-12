import type { CommandConstructor, CommandEffect } from './command'
import type { Example, JsonSchema } from '@/plugins/catalog'
import { BINARY } from '@/version/info'

export type CommandRow = {
  id: string
  usage: string
  summary: string
  effect?: CommandEffect
  input: JsonSchema
  positional: readonly string[]
  examples: readonly Example[]
}

// The op side of a descriptor: present once a command wraps a catalog op instead of a
// hand-written zod schema.
export type OpFacets = {
  op: string
  method: string
  path: string
  kind: string
  bind: Readonly<Record<string, string>>
  deprecated: boolean
  options?: JsonSchema
  pins?: Record<string, string | null>
}

export type Descriptor = CommandRow & Partial<OpFacets>

const FLAGS = '[flags]'

export function commandRow(ctor: CommandConstructor, path: readonly string[]): CommandRow {
  const id = path.join(' ')
  const args = ctor.positional.map((name) => `<${name}>`)
  const row: CommandRow = {
    id,
    usage: [BINARY, id, ...args, FLAGS].join(' '),
    summary: ctor.summary,
    input: ctor.schema(),
    positional: ctor.positional,
    examples: ctor.examples,
  }
  return ctor.effect === undefined ? row : { ...row, effect: ctor.effect }
}
